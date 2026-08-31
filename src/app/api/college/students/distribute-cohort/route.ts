export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { canHodEditDepartmentYear } from "@/lib/departments/managedBranches";
import { groupSectionsByBranch, sectionsForBranch } from "@/lib/sections/sectionLabel";
import { getAcademicStructure } from "@/lib/college/academicStructure";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { compareSectionsByName } from "@/lib/students/evenSplit";
import { buildDistributionPlan, validateDistributionPlan, validateStudentNames, type DistributionMove } from "@/lib/students/distributionPlan";
import { acquireDistributionLock, releaseDistributionLock, DistributionLockHeldError } from "@/lib/students/distributionLock";
import type { Section, StudentRecord } from "@/types";

// Sections a whole shared first-year intake in ONE action, for a college that
// runs year 1 in common (see src/lib/college/academicStructure.ts).
//
// The College Office imports first-years with only their real branch, so they
// all land unassigned (section == "") across IT, CSE, CSBS, ... The main
// first-year HOD would otherwise have to run the per-department distribute
// once for every branch; this does the whole year at once.
//
// Each branch's cohort is unassigned students plus everyone already sitting in
// one of that branch's OWN sections (never a student sitting in some other
// branch's section) - sorted by surname (surname -> full name -> id, see
// compareStudentsBySurname) and dealt back out evenly across all of the
// branch's sections (sorted by compareSectionsByName - natural name order,
// never database/query order), same as the per-department distribute route.
// This can move an already-placed student to a different section of the same
// branch so the whole branch stays in surname order as more students are
// imported later; only students who actually change section get written or
// get a departmentHistory entry (which is what makes re-running this with
// nothing new a no-op). Pass `dryRun: true` to get the computed plan back
// without writing anything - the exact same calculation the real run uses. A
// single `distributionLocks` doc for the whole year (see distributionLock.ts)
// blocks two concurrent runs of this route for the same year from racing.
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
    const body = (await request.json()) as { year?: number; dryRun?: boolean };

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

    // Every student for the year, across every branch (a plain single-field
    // query, always served without a composite index) - narrowed per-branch
    // below to unassigned-or-already-in-that-branch's-own-sections, so a
    // student already sitting in some OTHER branch's section never gets
    // pulled into this branch's cohort.
    const yearSnap = await collegeRef.collection("students")
      .where("year", "==", year)
      .get();

    const byBranch = new Map<string, (StudentRecord & { id: string })[]>();
    for (const d of yearSnap.docs) {
      const student = { id: d.id, ...(d.data() as Omit<StudentRecord, "id">) };
      const branch = (student.secondaryDepartment ?? student.department ?? "").trim();
      if (!branch) continue;
      const list = byBranch.get(branch);
      if (list) list.push(student);
      else byBranch.set(branch, [student]);
    }

    if (byBranch.size === 0) {
      return NextResponse.json(
        { error: `No students to distribute for year ${year}` },
        { status: 400 }
      );
    }

    // The year's sections, grouped by every branch they belong to - both the
    // managed-branch shape (owns its own section directly) and the legacy
    // secondaryDepartments shape (owned by the common department, merely
    // cross-listed to the branch - e.g. "MATHS-AIDS-A" owned by "Maths",
    // cross-listed to "Artificial Intelligence and Data Science"). See
    // groupSectionsByBranch's doc-comment; without the second shape, a
    // college using it would report every such branch as having "No Year N
    // sections created yet" despite them existing.
    const sectionsSnap = await collegeRef.collection("sections").where("year", "==", year).get();
    const sectionsByBranch = groupSectionsByBranch(
      sectionsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Section)
    );

    // A manager can run more than one course with different years, so
    // canHodEditDepartmentYear below needs each branch's own course to
    // resolve ownership against the right one, not always the manager's flat
    // years. Also used further below to recognize a cohort student's own
    // courseId as "this same programme" even when it points at a DIFFERENT
    // Course document than the branch's own sections do - every real branch
    // owns its own Course document for a programme it runs (see
    // StudentRecord.courseId's doc-comment), so a shared-first-year
    // student's courseId (resolved through their landing department's - or
    // its parent's - own copy at import/add time) never equals the branch's
    // own copy, even for the exact same programme; only catalogId is shared
    // across every department's own copy. Fetched once, unconditionally (not
    // just for HOD callers - the course-matching use below needs it
    // regardless of role), not per-branch.
    const coursesSnap = await collegeRef.collection("courses").get();
    const catalogIdByCourseId = new Map(coursesSnap.docs.map((c) => [c.id, (c.data() as { catalogId?: string }).catalogId]));

    const perBranch: {
      branch: string;
      managedBy?: string;
      distributed: number;
      perSection: { section: string; count: number }[];
      skippedReason?: string;
    }[] = [];

    // Phase 1 (resolve): work out, per branch, which students are actually
    // in scope and whether the branch can be processed at all - skip
    // reasons are recorded but nothing is written or even sorted/split yet.
    // Kept separate from Phase 2 so every branch's students can be
    // name-validated up front (see below) before ANY branch's writes start -
    // one bad record in branch Y must not leave branch X already
    // half-distributed.
    const readyBranches: { branch: string; managedBy?: string; sections: Section[]; students: (StudentRecord & { id: string })[] }[] = [];

    for (const [branch, students] of Array.from(byBranch.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      const managedBy = structure.managedBranchOwner.get(branch);
      const base = { branch, ...(managedBy ? { managedBy } : {}), distributed: 0, perSection: [] };

      // Never trust database/query order for section order - sections here
      // are re-sorted by natural name (compareSectionsByName), same as the
      // per-department distribute route.
      const sections = sectionsForBranch(sectionsByBranch, branch).sort(compareSectionsByName);

      if (sections.length === 0) {
        perBranch.push({ ...base, skippedReason: `No Year ${year} sections created yet` });
        continue;
      }

      // Out of scope for this branch's run: a student sitting in some OTHER
      // branch's section (byBranch only grouped by declared department/
      // secondaryDepartment, not by current section) never belongs here, even
      // if that other section happens to share this branch's name - only
      // unassigned or already-in-one-of-THIS-branch's-own-sections qualifies.
      const branchSectionNames = new Set(sections.map((s) => s.name));
      const inScope = students.filter((s) => s.section === "" || branchSectionNames.has(s.section));

      // This route has no per-section picker (it auto-distributes the whole
      // year at once) - it can't safely decide which of two different
      // courses' sections a given student belongs in, so a branch whose
      // sections span more than one course is skipped rather than risking a
      // mixed, wrongly-split roster. Use the per-department Distribute
      // dialog instead, which lets a single course be chosen explicitly.
      const branchCourseIds = new Set(sections.map((s) => s.courseId).filter(Boolean));
      if (branchCourseIds.size > 1) {
        perBranch.push({ ...base, skippedReason: "Sections span more than one course - use Distribute Unassigned instead" });
        continue;
      }
      const branchCourseId = sections[0]?.courseId;
      // Compared by catalogId, not the raw courseId - see the fetch above's
      // own comment for why the two can legitimately differ for the exact
      // same programme. Only a genuinely different catalogId (a real
      // different programme, e.g. M.Tech instead of B.Tech) excludes a
      // student here.
      const branchCatalogId = branchCourseId ? catalogIdByCourseId.get(branchCourseId) : undefined;
      const branchStudents = branchCourseId
        ? inScope.filter((s) =>
            !s.courseId
            || s.courseId === branchCourseId
            || (!!branchCatalogId && catalogIdByCourseId.get(s.courseId) === branchCatalogId)
          )
        : inScope;
      if (branchStudents.length === 0) {
        perBranch.push({ ...base, skippedReason: "No students declared for this branch's course" });
        continue;
      }

      // A (sub-)HOD may only section branches they own or manage FOR THIS YEAR -
      // a branch's own dedicated HOD never owns the shared year of a branch
      // grouped elsewhere (e.g. Basic Science manages CIVIL for year 1, even
      // though CIVIL's own HOD owns CIVIL for every other year). A branch
      // outside their scope is reported, not silently dropped. Checked
      // against each resolved section's own (actual) `department` - never
      // `branch` directly, since a legacy cross-listed section's real owner
      // is that department (e.g. "Maths"), not the branch it merely
      // cross-lists to; same fix as the per-department distribute route.
      // `catalogId` (from this branch's own Year-`year` sections, all
      // necessarily this one course) lets a manager running more than one
      // course resolve ownership against the right one.
      const catalogId = catalogIdByCourseId.get(sections[0]?.courseId ?? "");
      if (scope) {
        const owningDepartments = Array.from(new Set(sections.map((s) => s.department).filter(Boolean)));
        const allOwned = owningDepartments.every((d) => canHodEditDepartmentYear(scope, structure.allDepartments, d, year, catalogId));
        if (!allOwned) {
          perBranch.push({ ...base, skippedReason: "Not yours or one you manage" });
          continue;
        }
      }

      readyBranches.push({ branch, managedBy, sections, students: branchStudents });
    }

    if (readyBranches.length === 0) {
      return NextResponse.json(
        { error: "Nothing could be distributed - no branch had sections you can section into", perBranch },
        { status: 400 }
      );
    }

    // Reject the WHOLE run rather than silently sort an invalid record -
    // checked across every ready branch up front, before any branch's writes
    // start, so a bad record in one branch can't leave another half-done.
    const invalidNames = readyBranches.flatMap((b) => validateStudentNames(b.students).invalid.map((s) => ({ ...s, branch: b.branch })));
    if (invalidNames.length > 0) {
      return NextResponse.json(
        {
          error: "Some students have a missing or blank name and can't be sorted - fix them before distributing",
          invalidStudents: invalidNames,
        },
        { status: 400 }
      );
    }

    // Blocks a second concurrent whole-year cohort distribute while this one
    // is in flight (see distributionLock.ts). Locked at the whole-year level,
    // not per-branch - simpler, and the per-branch writes below are
    // idempotent regardless.
    const lockKey = `cohort::${year}`;
    try {
      await acquireDistributionLock(db, session.collegeId, lockKey, session.uid);
    } catch (lockErr) {
      if (lockErr instanceof DistributionLockHeldError) {
        return NextResponse.json(
          { error: "Another distribution is already running for this year - try again shortly" },
          { status: 409 }
        );
      }
      throw lockErr;
    }

    try {
      // Phase 2 (plan): build and validate each ready branch's plan - same
      // pure calculation a future preview would use.
      const branchPlans = readyBranches.map((b) => {
        const plan = buildDistributionPlan(b.students, b.sections);
        validateDistributionPlan(plan, new Set(b.students.map((s) => s.id)), new Set(b.sections.map((s) => s.id)));
        return { ...b, plan };
      });

      for (const { branch, managedBy, plan } of branchPlans) {
        perBranch.push({
          branch,
          ...(managedBy ? { managedBy } : {}),
          distributed: plan.movedCount,
          perSection: plan.perSection.map((s) => ({ section: s.sectionName, count: s.studentIds.length })),
        });
      }
      const distributed = branchPlans.reduce((sum, b) => sum + b.plan.movedCount, 0);

      if (body.dryRun) {
        return NextResponse.json({ success: true, dryRun: true, distributed, perBranch });
      }

      const now = new Date();
      const batch = new ChunkedBatch(db);
      const allMoves: (DistributionMove & { branch: string })[] = [];

      for (const { branch, sections, plan } of branchPlans) {
        const sectionById = new Map(sections.map((s) => [s.id, s]));
        for (const move of plan.moves) {
          const section = sectionById.get(move.toSectionId);
          if (!section) continue;
          allMoves.push({ ...move, branch });
          // department/secondaryDepartment are deliberately left untouched -
          // this route only ever processes the shared-year cohort, so every
          // student here stays enrolled under their original grouping
          // department until promotion (students/promote or advance-year)
          // actually transitions them into `branch`, same fix as the
          // per-student PATCH and the per-department distribute route.
          // courseId/course DO get set - see distribute/route.ts's identical
          // comment; StudentRecord.courseId always mirrors the section a
          // student is actually, currently sitting in.
          batch.update(collegeRef.collection("students").doc(move.studentId), {
            section: section.name,
            year,
            // One-time snapshot - see distribute/route.ts's own comment.
            regulation: section.regulation ?? null,
            courseId: section.courseId,
            course: section.courseName ?? null,
            updatedAt: now,
          });
          const history = departmentHistoryEntry(
            db, session.collegeId, move.studentId, branch, section.name, year, now, move.fromSectionName
          );
          batch.set(history.ref, history.data);
        }
      }

      try {
        await batch.commit();
      } catch (commitErr) {
        console.error("[college/students/distribute-cohort POST] partial commit failure", commitErr);
        // See distribute/route.ts's identical comment - ChunkedBatch has no
        // cross-chunk atomicity, but distribution is idempotent, so a plain
        // re-run of Distribute All safely finishes whatever this run didn't.
        return NextResponse.json(
          {
            error: "Distribution failed partway through - it's safe to re-run Distribute All, which will only move students not already in place",
            partial: true,
          },
          { status: 500 }
        );
      }

      // Post-write verification, same as distribute/route.ts - defense
      // against a concurrent, non-Distribute write racing in between
      // planning and commit.
      const verifySnaps = await Promise.all(
        allMoves.map((m) => collegeRef.collection("students").doc(m.studentId).get())
      );
      const unverified: string[] = [];
      verifySnaps.forEach((snap, i) => {
        const move = allMoves[i];
        if ((snap.data() as { section?: string } | undefined)?.section !== move.toSectionName) {
          unverified.push(move.studentId);
        }
      });
      const verified = unverified.length === 0;
      if (!verified) {
        console.error("[college/students/distribute-cohort POST] post-write verification mismatch", { unverified });
      }

      const auditRef = collegeRef.collection("auditLogs").doc();
      await auditRef.set({
        collegeId: session.collegeId,
        action: "STUDENT_SECTION_DISTRIBUTED",
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

      return NextResponse.json({ success: true, distributed, perBranch, verified, distributionId: auditRef.id });
    } finally {
      await releaseDistributionLock(db, session.collegeId, lockKey);
    }
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/distribute-cohort POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
