export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { getAcademicStructure } from "@/lib/college/academicStructure";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { resolveCurrentAcademicYear } from "@/lib/college/academicSession";
import { evenSplit } from "@/lib/students/evenSplit";
import type { Firestore } from "firebase-admin/firestore";
import type { Section, StudentRecord } from "@/types";

// Moves a whole year's cohort up to the next year. Two groups, two placement
// strategies:
//  - A PLAIN student (department is not the college's common department or
//    one of its sub-departments) keeps the SAME branch and SAME section
//    letter - "the same students, same branches and same sections move to
//    next year".
//  - A SHARED-FIRST-YEAR student is still filed under the common department
//    at this point (section-assignment deliberately leaves it that way - see
//    college/students/[id] PATCH, distribute, distribute-cohort) - promotion
//    is where they actually transition into their real branch
//    (secondaryDepartment), same as the per-student college/students/promote
//    flow. Their current section is a shared-year label (e.g. "BSC-CSE-A")
//    with no counterpart in the branch's own naming, so they're matched by
//    branch alone and evenly redistributed across whatever Year N+1 sections
//    that branch has - the same placement students/distribute-cohort uses to
//    section them the first time.
//
// Target sections must already exist. Rather than inventing sections on a
// Principal's behalf, a run that would land students nowhere refuses and names
// exactly which (branch, year, section) rows are missing, so the core HODs can
// create them first. `dryRun` returns that same report with a 200 so the UI can
// preflight before anyone commits.
//
// Per-student moves and graduation stay in college/students/promote.

interface MissingSection {
  department: string;
  year: number;
  section: string;
  students: number;
}

async function getUserName(db: Firestore, collegeId: string, uid: string): Promise<string> {
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    return (snap.data() as { name?: string } | undefined)?.name ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as { fromYear?: number; dryRun?: boolean };

    const fromYear = Number(body.fromYear);
    if (!fromYear || !Number.isFinite(fromYear) || fromYear < 1) {
      return NextResponse.json({ error: "fromYear is required" }, { status: 400 });
    }
    const toYear = fromYear + 1;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // Only REGULAR students advance - DETAINED students stay put by definition,
    // and GRADUATED ones are done. Matches college/students/promote.
    const cohortSnap = await collegeRef.collection("students").where("year", "==", fromYear).get();
    const cohort = cohortSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<StudentRecord, "id">) }))
      .filter((s) => s.status === "REGULAR" && (s.department ?? "").trim() && (s.section ?? "").trim());

    if (cohort.length === 0) {
      return NextResponse.json(
        { error: `No eligible (REGULAR, sectioned) students in year ${fromYear}` },
        { status: 400 }
      );
    }

    // A student currently filed under the college's common department or one
    // of its sub-departments hasn't reached their real branch yet - this is
    // exactly where that transition happens for them (matches
    // students/promote's already-correct per-student flow). Everyone else
    // advances the plain way.
    const structure = await getAcademicStructure(db, session.collegeId);
    const isSharedDept = (name: string) =>
      structure.commonDepartment?.name === name || structure.subDepartments.some((sd) => sd.name === name);
    const plainCohort = cohort.filter((s) => !isSharedDept(s.department.trim()));
    const sharedCohort = cohort.filter((s) => isSharedDept(s.department.trim()));

    // A shared-year student with no Secondary Department can't be routed
    // anywhere real - refuse up front (before touching sections at all)
    // rather than silently leaving them behind or guessing their branch.
    const unresolved = sharedCohort.filter((s) => !(s.secondaryDepartment ?? "").trim());
    if (unresolved.length > 0) {
      return NextResponse.json(
        {
          error: `${unresolved.length} student(s) have no Secondary Department set, so their real branch can't be resolved - fix these first: `
            + unresolved.slice(0, 10).map((s) => s.name || s.id).join(", ")
            + (unresolved.length > 10 ? `, and ${unresolved.length - 10} more` : ""),
        },
        { status: 409 }
      );
    }

    // Destination year's sections, indexed two ways: by exact (department,
    // section name) for the plain cohort's identical-letter match, and by
    // department alone for the shared cohort's even-split placement (their
    // current section is a shared-year label like "BSC-CSE-A" with no
    // counterpart in the branch's own naming, so it can't be matched by name).
    const targetSnap = await collegeRef.collection("sections").where("year", "==", toYear).get();
    const targetByKey = new Map<string, Section>();
    const targetSectionsByDept = new Map<string, Section[]>();
    for (const d of targetSnap.docs) {
      const s = { id: d.id, ...(d.data() as object) } as Section;
      const dept = (s.department ?? "").trim();
      targetByKey.set(`${dept}|${(s.name ?? "").trim().toUpperCase()}`, s);
      const list = targetSectionsByDept.get(dept);
      if (list) list.push(s); else targetSectionsByDept.set(dept, [s]);
    }

    // Plain cohort: group by where each student needs to land (unchanged).
    const groups = new Map<string, { department: string; section: string; students: typeof cohort }>();
    for (const student of plainCohort) {
      const department = student.department.trim();
      const section = student.section.trim();
      const key = `${department}|${section.toUpperCase()}`;
      const group = groups.get(key);
      if (group) group.students.push(student);
      else groups.set(key, { department, section, students: [student] });
    }

    const missing: MissingSection[] = [];
    for (const [key, group] of groups) {
      if (!targetByKey.has(key)) {
        missing.push({
          department: group.department,
          year: toYear,
          section: group.section,
          students: group.students.length,
        });
      }
    }

    // Shared cohort: group by resolved real branch only, evenly split across
    // whatever Year N+1 sections that branch has - same placement strategy
    // students/distribute-cohort uses to section them the first time.
    const sharedByBranch = new Map<string, typeof cohort>();
    for (const student of sharedCohort) {
      const branch = (student.secondaryDepartment ?? "").trim();
      const list = sharedByBranch.get(branch);
      if (list) list.push(student); else sharedByBranch.set(branch, [student]);
    }
    const sharedPlacements: { branch: string; sections: Section[]; students: typeof cohort }[] = [];
    for (const [branch, students] of sharedByBranch) {
      const sections = (targetSectionsByDept.get(branch) ?? [])
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
      if (sections.length === 0) {
        missing.push({ department: branch, year: toYear, section: "(any)", students: students.length });
        continue;
      }
      sharedPlacements.push({
        branch,
        sections,
        students: students.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
      });
    }

    if (missing.length > 0) {
      missing.sort((a, b) => a.department.localeCompare(b.department) || a.section.localeCompare(b.section));
      const summary = missing.map((m) => `${m.department} Year ${m.year} Section ${m.section}`).join(", ");
      // Nothing is written - the whole cohort advances together or not at all,
      // so a half-advanced year can't be left behind.
      return NextResponse.json(
        {
          error: `Create these sections first, then advance again: ${summary}`,
          missing,
          eligible: cohort.length,
        },
        { status: 409 }
      );
    }

    const preview = {
      fromYear,
      toYear,
      eligible: cohort.length,
      groups: [
        ...Array.from(groups.values()).map((g) => ({ department: g.department, section: g.section, students: g.students.length })),
        ...sharedPlacements.map((p) => ({
          department: p.branch,
          section: `(${p.sections.length} section${p.sections.length === 1 ? "" : "s"})`,
          students: p.students.length,
        })),
      ].sort((a, b) => a.department.localeCompare(b.department) || a.section.localeCompare(b.section)),
      missing: [] as MissingSection[],
    };

    if (body.dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, ...preview });
    }

    const now = new Date();
    // ChunkedBatch rotates at Firestore's 500-op ceiling, so a college-wide
    // cohort (well past promote's 400-per-call cap) advances in one request.
    const batch = new ChunkedBatch(db);
    for (const group of groups.values()) {
      for (const student of group.students) {
        batch.update(collegeRef.collection("students").doc(student.id), {
          // department and section are deliberately untouched - only the year
          // moves. secondaryDepartment is cleared for the same reason
          // college/students/promote clears it: once a student is in their own
          // branch's year, a pre-registration pointer is redundant.
          year: toYear,
          secondaryDepartment: null,
          updatedAt: now,
        });
        const history = departmentHistoryEntry(
          db, session.collegeId, student.id, group.department, group.section, toYear, now
        );
        batch.set(history.ref, history.data);
      }
    }
    for (const placement of sharedPlacements) {
      const slices = evenSplit(placement.students, placement.sections.length);
      for (let i = 0; i < placement.sections.length; i++) {
        const section = placement.sections[i];
        for (const student of slices[i]) {
          batch.update(collegeRef.collection("students").doc(student.id), {
            // The actual shared-year -> real-branch transition: department
            // becomes the resolved branch, secondaryDepartment (now redundant)
            // is cleared.
            department: placement.branch,
            section: section.name,
            year: toYear,
            secondaryDepartment: null,
            updatedAt: now,
          });
          const history = departmentHistoryEntry(
            db, session.collegeId, student.id, placement.branch, section.name, toYear, now
          );
          batch.set(history.ref, history.data);
        }
      }
    }

    await batch.commit();

    // ─── Academic year roll-over ──────────────────────────────────────────
    // The destination course-years are now running the college's current
    // session, so their CourseAcademicYear label follows the cohort up instead
    // of having to be retyped per course.
    //
    // Written directly rather than through course-academic-years POST on
    // purpose: that route treats a label change on an existing doc as an
    // "advance" and credits every assigned faculty member with +1 experience
    // year. That is not idempotent, so it must stay on the Principal's
    // explicit Advance button and never fire from a bulk student move.
    const advancedCourseYears: string[] = [];
    try {
      const sessionsSnap = await collegeRef.collection("academicSessions").where("isCurrent", "==", true).limit(1).get();
      const currentLabel = resolveCurrentAcademicYear(
        sessionsSnap.empty ? undefined : (sessionsSnap.docs[0].data() as { label?: string }).label
      );

      // Only the destination sections that actually took students.
      const courseIds = new Set<string>();
      for (const [key, group] of groups) {
        if (group.students.length === 0) continue;
        const courseId = targetByKey.get(key)?.courseId;
        if (courseId) courseIds.add(courseId);
      }
      for (const placement of sharedPlacements) {
        for (const section of placement.sections) {
          if (section.courseId) courseIds.add(section.courseId);
        }
      }

      if (courseIds.size > 0) {
        const yearBatch = db.batch();
        let writes = 0;
        for (const courseId of courseIds) {
          const ref = collegeRef.collection("courseAcademicYears").doc(`${courseId}_year${toYear}`);
          const snap = await ref.get();
          const existingLabel = snap.exists ? (snap.data() as { label?: string }).label : undefined;
          if (existingLabel === currentLabel) continue;
          const courseDoc = await collegeRef.collection("courses").doc(courseId).get();
          const departmentId = (courseDoc.data() as { departmentId?: string } | undefined)?.departmentId ?? "";
          yearBatch.set(ref, {
            collegeId: session.collegeId,
            departmentId,
            courseId,
            year: toYear,
            label: currentLabel,
            ...(snap.exists ? { updatedAt: now } : { createdAt: now, updatedAt: now }),
          }, { merge: true });
          writes++;
          advancedCourseYears.push(courseId);
        }
        if (writes > 0) await yearBatch.commit();
      }
    } catch (err) {
      // Non-fatal: the cohort has already moved, and the label can still be set
      // by hand. Swallowing it here beats failing a committed promotion.
      console.error("[college/students/advance-year academic-year roll-over]", err);
    }

    const performedByName = await getUserName(db, session.collegeId, session.uid);
    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "STUDENT_PROMOTED",
      performedBy: session.uid,
      performedByName,
      details: {
        kind: "COHORT_ADVANCED",
        fromYear,
        toYear,
        count: cohort.length,
        groups: preview.groups,
        academicYearsRolled: advancedCourseYears.length,
      },
      timestamp: now,
    });

    return NextResponse.json({ ok: true, ...preview, advanced: cohort.length, academicYearsRolled: advancedCourseYears.length });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/advance-year POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
