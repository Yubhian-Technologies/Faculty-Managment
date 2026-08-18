export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { canHodEditDepartmentYear, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { evenSplit } from "@/lib/students/evenSplit";
import type { Section, StudentRecord } from "@/types";

// Bulk-distribute a department's UNASSIGNED students (section == "") across a
// set of that department's sections, split evenly in full-name order: the
// students are sorted by name and dealt out to the chosen sections in order, so
// the earliest names land in the first section, the next block in the second,
// and so on. Roll numbers are left exactly as imported. This is the "divide the
// branch's students into sections A/B/C by initial" step a sub-HOD runs after
// creating the sections. Each moved student also gets a departmentHistory entry.
//
// A shared-first-year student is enrolled under the grouping (sub-)department
// (e.g. "BS-Mathematics") with `secondaryDepartment` naming their real branch
// (e.g. "cse") - but that branch's sections are filed under the branch itself,
// never under the grouping department (see hod/sections/new's managed-branch
// mode). `secondaryDepartment` in the body names which branch to route through:
// the cohort is narrowed to students pre-registered to it, and the target
// sections/placement resolve against the branch, not the grouping department.
// Omitted for a plain department (no shared-year structure), which behaves
// exactly as before.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const body = (await request.json()) as {
      departmentId?: string;
      department?: string;
      secondaryDepartment?: string;
      year: number;
      sectionIds: string[];
    };

    if (!body.year || !Array.isArray(body.sectionIds) || body.sectionIds.length === 0) {
      return NextResponse.json({ error: "year and at least one section are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const year = Number(body.year);

    // Resolve the target department name (by id or name).
    let deptName = "";
    if (body.departmentId) {
      const deptSnap = await collegeRef.collection("departments").doc(body.departmentId).get();
      if (!deptSnap.exists) return NextResponse.json({ error: "Department not found" }, { status: 400 });
      deptName = (deptSnap.data() as { name?: string }).name ?? "";
    } else if (body.department?.trim()) {
      const deptSnap = await collegeRef.collection("departments").where("name", "==", body.department.trim()).limit(1).get();
      if (deptSnap.empty) return NextResponse.json({ error: "Department not found" }, { status: 400 });
      deptName = (deptSnap.docs[0].data() as { name?: string }).name ?? body.department.trim();
    } else {
      return NextResponse.json({ error: "department or departmentId is required" }, { status: 400 });
    }

    // The department sections/placement actually resolve against - the chosen
    // real branch when routing a shared-first-year cohort through one,
    // otherwise deptName itself (unchanged, plain-department behaviour).
    const secondaryDeptName = body.secondaryDepartment?.trim() || "";
    const targetDeptName = secondaryDeptName || deptName;

    // Load the chosen sections, preserving the caller's order, and validate each
    // belongs to this exact (target department, year).
    const sectionSnaps = await Promise.all(
      body.sectionIds.map((id) => collegeRef.collection("sections").doc(id).get())
    );
    const sections: Section[] = [];
    for (let i = 0; i < sectionSnaps.length; i++) {
      const snap = sectionSnaps[i];
      if (!snap.exists) return NextResponse.json({ error: `Section ${body.sectionIds[i]} not found` }, { status: 400 });
      const s = { id: snap.id, ...(snap.data() as object) } as Section;
      if (s.department !== targetDeptName || s.year !== year) {
        return NextResponse.json(
          { error: `Section ${s.name} is not a ${targetDeptName} Year ${year} section` },
          { status: 400 }
        );
      }
      sections.push(s);
    }

    // An HOD/Sub-HOD may only distribute within a department they own or
    // manage, and - for a managed branch reached only via `managedDepartments`
    // (e.g. Basic Science grouping CIVIL for its shared first year) - only for
    // the years that grouping actually covers. CIVIL's own years (2-4) stay
    // exclusively CIVIL's own dedicated HOD's to distribute, even though Basic
    // Science manages CIVIL for year 1. Checked against targetDeptName (the
    // branch actually being sectioned into), same as the section validation
    // and student write below. Mirrors the read-side check in `college/students`
    // GET and `college/sections` GET. `catalogId` (from the sections being
    // distributed into, all validated above to share this department+year, so
    // any one of them names the right course) lets a manager running more than
    // one course resolve ownership against the right one, not always its flat
    // years.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      const [deptsSnap, courseSnap] = await Promise.all([
        collegeRef.collection("departments").get(),
        sections[0]?.courseId ? collegeRef.collection("courses").doc(sections[0].courseId).get() : Promise.resolve(null),
      ]);
      const allDepts = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DepartmentYearRow[];
      const catalogId = courseSnap?.exists ? (courseSnap.data() as { catalogId?: string } | undefined)?.catalogId : undefined;
      if (!canHodEditDepartmentYear(scope, allDepts, targetDeptName, year, catalogId)) {
        return NextResponse.json({ error: "That department/year is not yours or one you manage" }, { status: 403 });
      }
    }

    // Load the unassigned cohort for this (department, year), sorted by full name.
    // Narrowed to students pre-registered to the chosen branch when routing
    // through one - filtered in memory rather than a 4th `.where()` clause, to
    // avoid requiring a new composite index for what's usually a small cohort.
    const unassignedSnap = await collegeRef.collection("students")
      .where("department", "==", deptName)
      .where("year", "==", year)
      .where("section", "==", "")
      .get();
    let cohort = unassignedSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<StudentRecord, "id">) }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    if (secondaryDeptName) {
      cohort = cohort.filter((s) => (s.secondaryDepartment ?? "").trim() === secondaryDeptName);
    }

    if (cohort.length === 0) {
      return NextResponse.json({ error: "No unassigned students to distribute for this department and year" }, { status: 400 });
    }

    // Even split in order: with N students over K sections, the first (N mod K)
    // sections get one extra, so sizes differ by at most one and earliest names
    // fill the earliest sections.
    const slices = evenSplit(cohort, sections.length);

    const now = new Date();
    const batch = new ChunkedBatch(db);
    const perSection: { section: string; count: number }[] = [];

    for (let i = 0; i < sections.length; i++) {
      const slice = slices[i];
      const section = sections[i];
      for (const student of slice) {
        const ref = collegeRef.collection("students").doc(student.id);
        // department/secondaryDepartment are deliberately left untouched, even
        // when routing a shared-first-year cohort through a real branch
        // (secondaryDeptName set) - every student here was queried by
        // department == deptName (the grouping department they're still
        // enrolled under), so writing department here would prematurely
        // transition them before promotion (students/promote or
        // advance-year), same fix as the per-student PATCH and
        // distribute-cohort.
        batch.update(ref, {
          section: section.name,
          year,
          updatedAt: now,
        });
        const history = departmentHistoryEntry(db, session.collegeId, student.id, deptName, section.name, year, now);
        batch.set(history.ref, history.data);
      }
      perSection.push({ section: section.name, count: slice.length });
    }

    await batch.commit();

    return NextResponse.json({ distributed: cohort.length, perSection });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/distribute POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
