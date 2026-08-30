export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { canHodEditDepartmentYear, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import { sectionFeedsTarget } from "@/lib/sections/sectionLabel";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { compareSectionsByName } from "@/lib/students/evenSplit";
import { buildDistributionPlan, validateDistributionPlan, validateStudentNames } from "@/lib/students/distributionPlan";
import { acquireDistributionLock, releaseDistributionLock, DistributionLockHeldError } from "@/lib/students/distributionLock";
import type { Section, StudentRecord } from "@/types";

// Bulk-distribute a department's students across a set of that department's
// sections, split evenly in surname order: every student who is either
// unassigned (section == "") or already sitting in one of the CHOSEN sections
// is pooled together, sorted by surname (the first word of `name`), and dealt
// back out to the chosen sections in order, so the earliest surnames land in
// the first section, the next block in the second, and so on. This can move a
// student who was already sitting in one of the chosen sections to a
// different one, so the whole picked group stays in correct surname order as
// new students are imported over time - a student sitting in a section that
// wasn't picked is never touched. Only students who actually change section
// get written (and get a departmentHistory entry); re-running with nothing new
// to place is a no-op. Roll numbers are left exactly as imported. This is the
// "divide the branch's students into sections A/B/C by surname" step a
// sub-HOD runs after creating the sections.
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
//
// `sectionIds` order is NEVER trusted as the business order - it's whatever
// order a checkbox UI happened to send (click order, not alphabetical). The
// resolved sections are always re-sorted here (compareSectionsByName) before
// splitting, so which section gets the earliest surnames never depends on
// how the caller picked them. Pass `dryRun: true` to get the computed plan
// back (counts + per-student moves) without writing anything - the exact
// same calculation the real run uses, so a preview can never drift from the
// commit. A `distributionLocks` doc (see distributionLock.ts) blocks two
// concurrent runs for the same department/branch/year from racing.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const body = (await request.json()) as {
      departmentId?: string;
      department?: string;
      secondaryDepartment?: string;
      year: number;
      sectionIds: string[];
      dryRun?: boolean;
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

    // Load the chosen sections and validate each actually belongs to
    // (deptName, targetDeptName, year) - either shape (see
    // sectionFeedsTarget's doc-comment): owned directly by targetDeptName (a
    // managed branch), or owned by deptName itself and cross-listed to
    // targetDeptName (a legacy secondaryDepartments section, e.g.
    // "MATHS-AIDS-A" owned by "Maths", cross-listed to "Artificial
    // Intelligence and Data Science"). Deduped since a repeat id would
    // otherwise double-count a section in the split below.
    const uniqueSectionIds = Array.from(new Set(body.sectionIds));
    const sectionSnaps = await Promise.all(
      uniqueSectionIds.map((id) => collegeRef.collection("sections").doc(id).get())
    );
    const sections: Section[] = [];
    for (let i = 0; i < sectionSnaps.length; i++) {
      const snap = sectionSnaps[i];
      if (!snap.exists) return NextResponse.json({ error: `Section ${uniqueSectionIds[i]} not found` }, { status: 400 });
      const s = { id: snap.id, ...(snap.data() as object) } as Section;
      if (!sectionFeedsTarget(s, deptName, secondaryDeptName) || s.year !== year) {
        return NextResponse.json(
          { error: `Section ${s.name} is not a ${targetDeptName} Year ${year} section` },
          { status: 400 }
        );
      }
      sections.push(s);
    }
    // Never trust `sectionIds`' order (checkbox click order, not alphabetical)
    // - this is the actual business order the split below uses.
    sections.sort(compareSectionsByName);

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

    // Load every student for this (department, year), then narrow in memory to
    // the ones this run may actually touch: unassigned (section == "") or
    // already sitting in one of the CHOSEN sections - a student sitting in a
    // section that wasn't picked is out of scope entirely. Filtered in memory
    // rather than adding a 4th `.where()` clause, same as the
    // secondaryDepartment/course filters below, to avoid requiring a new
    // composite index.
    const targetSectionNames = new Set(sections.map((s) => s.name));
    const deptYearSnap = await collegeRef.collection("students")
      .where("department", "==", deptName)
      .where("year", "==", year)
      .get();
    // Not sorted here - buildDistributionPlan sorts the final cohort itself
    // (surname -> full name -> id), so there's no point duplicating it.
    let cohort = deptYearSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<StudentRecord, "id">) }))
      .filter((s) => s.section === "" || targetSectionNames.has(s.section));
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
      return NextResponse.json({ error: "No students to distribute for this department and year" }, { status: 400 });
    }

    // Reject rather than silently sort an invalid record - an empty/blank
    // name has no usable surname and would otherwise sort first with no
    // indication anything's wrong.
    const { valid: validCohort, invalid: invalidNames } = validateStudentNames(cohort);
    if (invalidNames.length > 0) {
      return NextResponse.json(
        {
          error: "Some students have a missing or blank name and can't be sorted - fix them before distributing",
          invalidStudents: invalidNames,
        },
        { status: 400 }
      );
    }

    // Blocks a second concurrent Distribute for this exact department/branch/
    // year while this one is in flight (see distributionLock.ts).
    const lockKey = `${deptName}::${secondaryDeptName}::${year}`;
    try {
      await acquireDistributionLock(db, session.collegeId, lockKey, session.uid);
    } catch (lockErr) {
      if (lockErr instanceof DistributionLockHeldError) {
        return NextResponse.json(
          { error: "Another distribution is already running for this department/year - try again shortly" },
          { status: 409 }
        );
      }
      throw lockErr;
    }

    try {
      const plan = buildDistributionPlan(validCohort, sections);
      validateDistributionPlan(plan, new Set(validCohort.map((s) => s.id)), new Set(sections.map((s) => s.id)));

      if (body.dryRun) {
        return NextResponse.json({
          success: true,
          dryRun: true,
          totalStudents: plan.totalStudents,
          moved: plan.movedCount,
          sections: plan.perSection.map((s) => ({ sectionId: s.sectionId, sectionName: s.sectionName, studentCount: s.studentIds.length })),
          moves: plan.moves,
        });
      }

      const now = new Date();
      const batch = new ChunkedBatch(db);
      const sectionById = new Map(sections.map((s) => [s.id, s]));

      for (const move of plan.moves) {
        const section = sectionById.get(move.toSectionId);
        if (!section) continue;
        const ref = collegeRef.collection("students").doc(move.studentId);
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
        const history = departmentHistoryEntry(
          db, session.collegeId, move.studentId, deptName, section.name, year, now, move.fromSectionName
        );
        batch.set(history.ref, history.data);
      }

      try {
        await batch.commit();
      } catch (commitErr) {
        console.error("[college/students/distribute POST] partial commit failure", commitErr);
        // ChunkedBatch has no cross-chunk atomicity (see its own doc-comment) -
        // some of plan.moves may already be written. Distribution is
        // idempotent (a student already at their target section is a no-op),
        // so simply re-running Distribute with the same inputs safely
        // completes whatever this run didn't finish.
        return NextResponse.json(
          {
            error: "Distribution failed partway through - it's safe to re-run Distribute, which will only move students not already in place",
            partial: true,
          },
          { status: 500 }
        );
      }

      // Post-write verification: re-read the moved students and confirm the
      // write actually stuck - defense against a concurrent, non-Distribute
      // write (e.g. a single-student PATCH) racing in between planning and
      // commit; the lock above only blocks a second Distribute, not that.
      const verifySnaps = await Promise.all(
        plan.moves.map((m) => collegeRef.collection("students").doc(m.studentId).get())
      );
      const unverified: string[] = [];
      verifySnaps.forEach((snap, i) => {
        const move = plan.moves[i];
        if ((snap.data() as { section?: string } | undefined)?.section !== move.toSectionName) {
          unverified.push(move.studentId);
        }
      });
      const verified = unverified.length === 0;
      if (!verified) {
        console.error("[college/students/distribute POST] post-write verification mismatch", { unverified });
      }

      const auditRef = collegeRef.collection("auditLogs").doc();
      await auditRef.set({
        collegeId: session.collegeId,
        action: "STUDENT_SECTION_DISTRIBUTED",
        performedBy: session.uid,
        performedByName: session.role,
        details: {
          department: deptName,
          secondaryDepartment: secondaryDeptName || null,
          year,
          selectedSectionIds: sections.map((s) => s.id),
          totalStudents: plan.totalStudents,
          movedCount: plan.movedCount,
        },
        timestamp: now,
      });

      return NextResponse.json({
        success: true,
        totalStudents: plan.totalStudents,
        moved: plan.movedCount,
        sections: plan.perSection.map((s) => ({ sectionId: s.sectionId, sectionName: s.sectionName, studentCount: s.studentIds.length })),
        moves: plan.moves,
        verified,
        distributionId: auditRef.id,
      });
    } finally {
      await releaseDistributionLock(db, session.collegeId, lockKey);
    }
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/distribute POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
