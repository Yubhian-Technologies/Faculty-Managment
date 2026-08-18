export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { canHodEditDepartmentYear } from "@/lib/departments/managedBranches";
import { getAcademicStructure } from "@/lib/college/academicStructure";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { evenSplit } from "@/lib/students/evenSplit";
import type { Section, StudentRecord } from "@/types";

// Sections a whole shared first-year intake in ONE action, for a college that
// runs year 1 in common (see src/lib/college/academicStructure.ts).
//
// The College Office imports first-years with only their real branch, so they
// all land unassigned (section == "") across IT, CSE, CSBS, ... The main
// first-year HOD would otherwise have to run the per-department distribute
// once for every branch; this does the whole year at once.
//
// Crucially, every student ends up in their OWN branch: an IT student is placed
// into an IT section, never into a sub-department. The sub-department
// (BS-Maths, BS-English) is a management view that reaches those students
// through Department.managedDepartments - it never becomes their department.
//
// A student's branch is `secondaryDepartment` when set - the College Office
// enrolls a shared-first-year student under the grouping department (e.g.
// "BS-Mathematics") with their real branch (e.g. "cse") only as that pointer,
// since the branch's own sections don't exist until the sub-HOD creates them.
// Falls back to `department` itself for a student already stored under their
// real branch (a college using `managedDepartments` from the start, with no
// grouping-department detour). On placement, `department` is corrected to
// match (and the now-redundant `secondaryDepartment` cleared) - the student
// becomes a real member of their branch the moment they land in one of its
// sections.
//
// Branches with no sections yet are reported back rather than failing the run,
// so one unprepared branch can't block the rest of the year.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as { year?: number };

    const year = Number(body.year);
    if (!year || !Number.isFinite(year)) {
      return NextResponse.json({ error: "year is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // Only meaningful on a college that actually runs a shared year - on a
    // department-direct college the per-department distribute is the right tool.
    const structure = await getAcademicStructure(db, session.collegeId);
    if (!structure.isCommonFirstYear || !structure.commonYears.includes(year)) {
      return NextResponse.json(
        { error: `Year ${year} is not run as a shared year for this college` },
        { status: 400 }
      );
    }

    const scope = session.role === "HOD"
      ? await getHodDepartmentScope(db, session.collegeId, session.uid)
      : null;

    // The whole unassigned cohort for the year, across every branch. Served by
    // the existing students `section + year` composite index.
    const unassignedSnap = await collegeRef.collection("students")
      .where("year", "==", year)
      .where("section", "==", "")
      .get();

    const byBranch = new Map<string, (StudentRecord & { id: string })[]>();
    for (const d of unassignedSnap.docs) {
      const student = { id: d.id, ...(d.data() as Omit<StudentRecord, "id">) };
      const branch = (student.secondaryDepartment ?? student.department ?? "").trim();
      if (!branch) continue;
      const list = byBranch.get(branch);
      if (list) list.push(student);
      else byBranch.set(branch, [student]);
    }

    if (byBranch.size === 0) {
      return NextResponse.json(
        { error: `No unassigned students to distribute for year ${year}` },
        { status: 400 }
      );
    }

    // The year's sections, grouped by the branch that owns them.
    const sectionsSnap = await collegeRef.collection("sections").where("year", "==", year).get();
    const sectionsByBranch = new Map<string, Section[]>();
    for (const d of sectionsSnap.docs) {
      const section = { id: d.id, ...(d.data() as object) } as Section;
      const branch = (section.department ?? "").trim();
      if (!branch) continue;
      const list = sectionsByBranch.get(branch);
      if (list) list.push(section);
      else sectionsByBranch.set(branch, [section]);
    }

    // A manager can run more than one course with different years, so
    // canHodEditDepartmentYear below needs each branch's own course to
    // resolve ownership against the right one, not always the manager's flat
    // years. Fetched once (only when actually needed - an HOD scope exists),
    // not per-branch.
    let catalogIdByCourseId = new Map<string, string | undefined>();
    if (scope) {
      const coursesSnap = await collegeRef.collection("courses").get();
      catalogIdByCourseId = new Map(coursesSnap.docs.map((c) => [c.id, (c.data() as { catalogId?: string }).catalogId]));
    }

    const now = new Date();
    const batch = new ChunkedBatch(db);
    const perBranch: {
      branch: string;
      managedBy?: string;
      distributed: number;
      perSection: { section: string; count: number }[];
      skippedReason?: string;
    }[] = [];
    let distributed = 0;

    for (const [branch, students] of Array.from(byBranch.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      const managedBy = structure.managedBranchOwner.get(branch);
      const base = { branch, ...(managedBy ? { managedBy } : {}), distributed: 0, perSection: [] };

      const sections = (sectionsByBranch.get(branch) ?? []).sort((a, b) =>
        (a.name ?? "").localeCompare(b.name ?? "")
      );

      // A (sub-)HOD may only section branches they own or manage FOR THIS YEAR -
      // a branch's own dedicated HOD never owns the shared year of a branch
      // grouped elsewhere (e.g. Basic Science manages CIVIL for year 1, even
      // though CIVIL's own HOD owns CIVIL for every other year). A branch
      // outside their scope is reported, not silently dropped. `catalogId`
      // (from this branch's own Year-`year` sections, all necessarily this
      // one course) lets a manager running more than one course resolve
      // ownership against the right one.
      const catalogId = catalogIdByCourseId.get(sections[0]?.courseId ?? "");
      if (scope && !canHodEditDepartmentYear(scope, structure.allDepartments, branch, year, catalogId)) {
        perBranch.push({ ...base, skippedReason: "Not yours or one you manage" });
        continue;
      }
      if (sections.length === 0) {
        perBranch.push({ ...base, skippedReason: `No Year ${year} sections created yet` });
        continue;
      }

      // Same name-ordered even split the per-department distribute uses, so
      // both paths section a branch identically.
      const sorted = students.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
      const slices = evenSplit(sorted, sections.length);
      const perSection: { section: string; count: number }[] = [];

      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        for (const student of slices[i]) {
          // department/secondaryDepartment are deliberately left untouched -
          // this route only ever processes the shared-year cohort, so every
          // student here stays enrolled under their original grouping
          // department until promotion (students/promote or advance-year)
          // actually transitions them into `branch`, same fix as the
          // per-student PATCH and the per-department distribute route.
          batch.update(collegeRef.collection("students").doc(student.id), {
            section: section.name,
            year,
            updatedAt: now,
          });
          const history = departmentHistoryEntry(
            db, session.collegeId, student.id, student.department, section.name, year, now
          );
          batch.set(history.ref, history.data);
        }
        perSection.push({ section: section.name, count: slices[i].length });
      }

      distributed += sorted.length;
      perBranch.push({ ...base, distributed: sorted.length, perSection });
    }

    if (distributed === 0) {
      return NextResponse.json(
        { error: "Nothing could be distributed - no branch had sections you can section into", perBranch },
        { status: 400 }
      );
    }

    await batch.commit();

    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "STUDENT_PROMOTED",
      performedBy: session.uid,
      performedByName: session.role,
      details: {
        kind: "COHORT_DISTRIBUTED",
        year,
        distributed,
        branches: perBranch.map((b) => ({ branch: b.branch, count: b.distributed })),
      },
      timestamp: now,
    });

    return NextResponse.json({ distributed, perBranch });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/distribute-cohort POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
