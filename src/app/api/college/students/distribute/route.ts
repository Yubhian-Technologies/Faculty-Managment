export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { canHodEditDepartmentYear, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import { sectionFeedsTarget } from "@/lib/sections/sectionLabel";
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
    // actually belongs to (deptName, targetDeptName, year) - either shape (see
    // sectionFeedsTarget's doc-comment): owned directly by targetDeptName (a
    // managed branch), or owned by deptName itself and cross-listed to
    // targetDeptName (a legacy secondaryDepartments section, e.g.
    // "MATHS-AIDS-A" owned by "Maths", cross-listed to "Artificial
    // Intelligence and Data Science").
    const sectionSnaps = await Promise.all(
      body.sectionIds.map((id) => collegeRef.collection("sections").doc(id).get())
    );
    const sections: Section[] = [];
    for (let i = 0; i < sectionSnaps.length; i++) {
      const snap = sectionSnaps[i];
      if (!snap.exists) return NextResponse.json({ error: `Section ${body.sectionIds[i]} not found` }, { status: 400 });
      const s = { id: snap.id, ...(snap.data() as object) } as Section;
      if (!sectionFeedsTarget(s, deptName, secondaryDeptName) || s.year !== year) {
        return NextResponse.json(
          { error: `Section ${s.name} is not a ${targetDeptName} Year ${year} section` },
          { status: 400 }
        );
      }
      sections.push(s);
    }

    // A single Distribute action targets exactly one course - the sections
    // chosen must all share it (they already share department+year above).
    // Without this, sections from two different courses (e.g. a B.Tech
    // "PHYSICS-IT-A" and an M.Tech section picked together by mistake) could
    // both receive students from a mixed cohort, silently placing some into
    // the wrong course's roster.
    const targetCourseIds = new Set(sections.map((s) => s.courseId).filter(Boolean));
    if (targetCourseIds.size > 1) {
      return NextResponse.json(
        { error: "Selected sections belong to more than one course - choose sections from a single course" },
        { status: 400 }
      );
    }
    const targetCourseId = sections[0]?.courseId;
    // The catalog-level identity behind targetCourseId (e.g. "Bachelor of
    // Technology") - every real branch owns its OWN Course document for a
    // programme it runs (see StudentRecord.courseId's doc-comment), so this
    // section's own courseId is never the same DOCUMENT a shared-first-year
    // student's courseId points at (resolved through their landing
    // department's - or its parent's - own copy at import/add time), even
    // when it's the exact same programme. catalogId is the field that's
    // actually shared across every department's own copy - used below both
    // for HOD-scope ownership (already needed it) and, further down, to
    // recognize a cohort student as "this same programme" even though their
    // stored courseId points at a different Course document entirely.
    let targetCatalogId: string | undefined;
    if (targetCourseId) {
      const courseSnap = await collegeRef.collection("courses").doc(targetCourseId).get();
      targetCatalogId = courseSnap.exists ? (courseSnap.data() as { catalogId?: string } | undefined)?.catalogId : undefined;
    }

    // An HOD/Sub-HOD may only distribute within a department they own or
    // manage, and - for a managed branch reached only via `managedDepartments`
    // (e.g. Basic Science grouping CIVIL for its shared first year) - only for
    // the years that grouping actually covers. CIVIL's own years (2-4) stay
    // exclusively CIVIL's own dedicated HOD's to distribute, even though Basic
    // Science manages CIVIL for year 1. Checked against each selected
    // section's own (actual, Firestore-stored) `department` - never
    // targetDeptName directly, since a legacy cross-listed section's real
    // owner is deptName (e.g. "Maths"), not the branch it merely cross-lists
    // to; targetDeptName is only the true owner for the managed-branch shape.
    // Mirrors the read-side check in `college/students` GET, `college/sections`
    // GET, and students/[id] PATCH (which checks targetSection.department the
    // same way). `catalogId` (from the sections being distributed into, all
    // validated above to share this department+year, so any one of them names
    // the right course) lets a manager running more than one course resolve
    // ownership against the right one, not always its flat years.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      const deptsSnap = await collegeRef.collection("departments").get();
      const allDepts = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DepartmentYearRow[];
      const owningDepartments = Array.from(new Set(sections.map((s) => s.department).filter(Boolean)));
      const allOwned = owningDepartments.every((d) => canHodEditDepartmentYear(scope, allDepts, d, year, targetCatalogId));
      if (!allOwned) {
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
    // Only students who either declared no course yet, or already declared
    // this exact PROGRAMME - a student who declared a genuinely DIFFERENT
    // programme (a different catalogId - e.g. M.Tech instead of B.Tech) must
    // not be swept into these sections just because they're also unassigned
    // in the same department+year (see targetCourseId/targetCatalogId
    // above). Compared by catalogId, not the raw courseId: a shared-
    // first-year student's own courseId was resolved through their landing
    // department's (or its parent's) own Course document, which is a
    // DIFFERENT document from the target section's real branch's own copy of
    // the exact same programme - comparing the raw ids directly would wrongly
    // exclude every such student from ever being distributable.
    if (targetCourseId) {
      const cohortCourseIds = Array.from(new Set(cohort.map((s) => s.courseId).filter((c): c is string => !!c)));
      const catalogIdByCourseId = new Map<string, string | undefined>();
      if (targetCatalogId && cohortCourseIds.length > 0) {
        const courseSnaps = await Promise.all(cohortCourseIds.map((id) => collegeRef.collection("courses").doc(id).get()));
        courseSnaps.forEach((snap, i) => {
          catalogIdByCourseId.set(cohortCourseIds[i], snap.exists ? (snap.data() as { catalogId?: string } | undefined)?.catalogId : undefined);
        });
      }
      cohort = cohort.filter((s) => {
        if (!s.courseId) return true;
        if (s.courseId === targetCourseId) return true;
        return !!targetCatalogId && catalogIdByCourseId.get(s.courseId) === targetCatalogId;
      });
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
        // distribute-cohort. courseId/course DO get set here though - the
        // student is now genuinely sitting in `section`, so its own courseId
        // is the only correct, unambiguous value from this point on (see
        // StudentRecord.courseId's doc-comment).
        batch.update(ref, {
          section: section.name,
          year,
          // One-time snapshot of the section's CURRENT regulation - the
          // student's own copy, fixed for their whole academic run regardless
          // of what this section's own `regulation` is later edited to for a
          // different batch (see Section.regulation's doc-comment).
          regulation: section.regulation ?? null,
          courseId: section.courseId,
          course: section.courseName ?? null,
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
