export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import type { Firestore } from "firebase-admin/firestore";
import { sectionParityGap, describeSectionParityGap } from "@/lib/college/sectionParity";
import { invalidPromotion, notInFinalYear, notInSourceSection } from "@/lib/students/promotionRules";
import { setStudentLoginActive } from "@/lib/students/provisionLogin";
import type { Section, StudentRecord } from "@/types";

const MAX_STUDENTS_PER_CALL = 400;

async function getUserName(db: Firestore, collegeId: string, uid: string): Promise<string> {
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    return (snap.data() as { name?: string } | undefined)?.name ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

// Principal/VP/College Office move a cohort of REGULAR students to a
// different department's section for the next year (PROMOTE), or mark a
// final-year cohort complete (GRADUATE). Targets a single destination per
// call - the "bulk-by-section with per-student override" UX
// (StudentPromotionsPanel, used by both principal/students's "Promotion" tab
// and college-office/students's own) groups students by their resolved
// target and fires one call per group.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const body = (await request.json()) as {
      studentIds: string[];
      action: "PROMOTE" | "GRADUATE";
      targetSectionId?: string;
      // GRADUATE only - the final-year section these students are graduating
      // out of, so the batch/course it carries can be snapshotted onto each
      // student record (see StudentRecord.graduation* fields).
      // PROMOTE: the section the students are leaving - enables the
      // matching-sections check and carries its batch/regulation forward.
      sourceSectionId?: string;
    };

    const studentIds = Array.isArray(body.studentIds) ? body.studentIds : [];
    if (studentIds.length === 0) {
      return NextResponse.json({ error: "studentIds is required" }, { status: 400 });
    }
    if (studentIds.length > MAX_STUDENTS_PER_CALL) {
      return NextResponse.json(
        { error: `At most ${MAX_STUDENTS_PER_CALL} students per call - split into multiple requests` },
        { status: 400 }
      );
    }
    if (body.action !== "PROMOTE" && body.action !== "GRADUATE") {
      return NextResponse.json({ error: "action must be PROMOTE or GRADUATE" }, { status: 400 });
    }
    if (body.action === "PROMOTE" && !body.targetSectionId) {
      return NextResponse.json({ error: "targetSectionId is required for PROMOTE" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    let targetSection: Section | null = null;
    if (body.action === "PROMOTE") {
      const targetSnap = await collegeRef.collection("sections").doc(body.targetSectionId!).get();
      if (!targetSnap.exists) {
        return NextResponse.json({ error: "Target section not found" }, { status: 404 });
      }
      targetSection = { id: targetSnap.id, ...(targetSnap.data() as object) } as Section;
    }

    // A cohort moves up a year into the SAME course's next-year sections, so
    // the two years must have exactly the same section names - a missing one
    // has nowhere to receive its students, an extra one would be left empty.
    // The Principal fixes the sections first (add/remove), then promotes.
    // Skipped for a shared-first-year feeder section (it fans out into other
    // departments' sections, so its names legitimately differ).
    let promoteSource: Section | null = null;
    if (body.action === "PROMOTE" && body.sourceSectionId) {
      const sourceSnap = await collegeRef.collection("sections").doc(body.sourceSectionId).get();
      if (sourceSnap.exists) {
        promoteSource = { id: sourceSnap.id, ...(sourceSnap.data() as object) } as Section;
        const isFeeder = (promoteSource.secondaryDepartments?.length ?? 0) > 0;
        if (!isFeeder && promoteSource.courseId === targetSection!.courseId) {
          const courseSections = await collegeRef.collection("sections").where("courseId", "==", promoteSource.courseId).get();
          const gap = sectionParityGap(
            courseSections.docs.map((d) => d.data() as Section),
            promoteSource.department,
            promoteSource.courseId,
            promoteSource.year,
            targetSection!.year
          );
          if (gap.missing.length > 0 || gap.extra.length > 0) {
            return NextResponse.json(
              { error: describeSectionParityGap(gap, promoteSource.year, targetSection!.year), ...gap },
              { status: 409 }
            );
          }
        }
      }
    }

    let graduationSource: Section | null = null;
    if (body.action === "GRADUATE" && body.sourceSectionId) {
      const sourceSnap = await collegeRef.collection("sections").doc(body.sourceSectionId).get();
      if (sourceSnap.exists) {
        graduationSource = { id: sourceSnap.id, ...(sourceSnap.data() as object) } as Section;
      }
    }

    const studentSnaps = await Promise.all(
      studentIds.map((id) => collegeRef.collection("students").doc(id).get())
    );

    // Programme (catalogId) and length (durationYears) of every course involved,
    // for the PROMOTE programme check and the GRADUATE final-year check.
    const courseIds = new Set<string>();
    if (targetSection?.courseId) courseIds.add(targetSection.courseId);
    if (promoteSource?.courseId) courseIds.add(promoteSource.courseId);
    if (graduationSource?.courseId) courseIds.add(graduationSource.courseId);
    for (const snap of studentSnaps) {
      const cid = snap.exists ? (snap.data() as StudentRecord).courseId : undefined;
      if (cid) courseIds.add(cid);
    }
    const courseInfo = new Map<string, { catalogId?: string; durationYears?: number }>();
    await Promise.all(
      Array.from(courseIds).map(async (cid) => {
        const c = await collegeRef.collection("courses").doc(cid).get();
        if (c.exists) courseInfo.set(cid, c.data() as { catalogId?: string; durationYears?: number });
      })
    );
    const catalogOf = (cid: string | undefined) => (cid ? courseInfo.get(cid)?.catalogId : undefined);
    // The section being graduated out of is the best authority on which course
    // (and so how many years) this cohort is finishing; fall back to each student's own.
    const finalYearFor = (student: StudentRecord) =>
      courseInfo.get(graduationSource?.courseId ?? student.courseId ?? "")?.durationYears;

    const now = new Date();
    const batch = new ChunkedBatch(db);
    let updatedCount = 0;
    const skipped: string[] = [];
    const skippedReasons: { id: string; name: string; reason: string }[] = [];
    const graduatedUids: string[] = [];
    const skip = (id: string, name: string, reason: string) => {
      skipped.push(id);
      skippedReasons.push({ id, name, reason });
    };

    for (const snap of studentSnaps) {
      if (!snap.exists) {
        skip(snap.id, "", "student not found");
        continue;
      }
      const student = snap.data() as StudentRecord;
      if (student.status !== "REGULAR") {
        skip(snap.id, student.name, `status is ${student.status}`);
        continue;
      }

      if (body.action === "GRADUATE") {
        const notFinal = notInFinalYear(student, finalYearFor(student));
        if (notFinal) {
          skip(snap.id, student.name, notFinal);
          continue;
        }
        const notInSource = notInSourceSection(student, graduationSource);
        if (notInSource) {
          skip(snap.id, student.name, notInSource);
          continue;
        }
        batch.update(snap.ref, {
          status: "GRADUATED",
          updatedAt: now,
          graduatedAt: now,
          ...(graduationSource
            ? {
                graduationBatch: graduationSource.batch,
                graduationCourseId: graduationSource.courseId,
                graduationCourseName: graduationSource.courseName ?? "",
              }
            : {}),
        });
        if (student.uid) graduatedUids.push(student.uid);
      } else {
        const notInSource = notInSourceSection(student, promoteSource);
        if (notInSource) {
          skip(snap.id, student.name, notInSource);
          continue;
        }
        const invalid = invalidPromotion(student, targetSection!, catalogOf);
        if (invalid) {
          skip(snap.id, student.name, invalid);
          continue;
        }
        batch.update(snap.ref, {
          department: targetSection!.department,
          year: targetSection!.year,
          section: targetSection!.name,
          // Clear it: if this promotion is exactly a student's pre-registered
          // secondary department becoming their new primary one, a leftover
          // secondaryDepartment would be redundant (and stale/misleading if
          // it was ever anything else, e.g. corrected mid-way).
          secondaryDepartment: null,
          // The student is now genuinely sitting in targetSection, so its own
          // courseId is the only correct, unambiguous value from this point on
          // (see StudentRecord.courseId's doc-comment) - same fix already
          // applied at every other place a student gets placed into a section
          // (students/[id] PATCH's targetSectionId move, distribute,
          // distribute-cohort). Left stale here before, a promotion that also
          // changes department (the common shared-first-year -> real-branch
          // case, which this route is explicitly used for) silently broke
          // every courseId-scoped query for the student's new section -
          // section student counts (sections/route.ts GET), attendance
          // rosters/reports (sectionRoster.ts's fetchSectionStudents), and HOD
          // department-scope resolution (catalogIdForStudent).
          courseId: targetSection!.courseId,
          course: targetSection!.courseName ?? null,
          // A lab batch belongs to the section it was set in - a promoted student
          // starts the new year with none (the new section's faculty batches them).
          labBatch: "",
          updatedAt: now,
        });
        const history = departmentHistoryEntry(
          db, session.collegeId, snap.id, targetSection!.department, targetSection!.name, targetSection!.year, now
        );
        batch.set(history.ref, history.data);
      }
      updatedCount++;
    }

    if (updatedCount === 0) {
      return NextResponse.json(
        {
          error: skippedReasons.length > 0
            ? `No eligible students to update - ${skippedReasons[0].name ? `${skippedReasons[0].name}: ` : ""}${skippedReasons[0].reason}`
            : "No eligible (REGULAR) students to update",
          skipped,
          skippedReasons,
        },
        { status: 400 }
      );
    }

    // The cohort now occupies the target slot, so the slot's batch (and the
    // regulation that batch follows) becomes the cohort's own - the year is
    // never re-typed by hand after a promotion.
    if (promoteSource && targetSection && promoteSource.courseId === targetSection.courseId && (promoteSource.secondaryDepartments?.length ?? 0) === 0) {
      const sync: Record<string, unknown> = {};
      if (promoteSource.batch && promoteSource.batch !== targetSection.batch) sync.batch = promoteSource.batch;
      if ((promoteSource.regulation ?? null) !== (targetSection.regulation ?? null)) sync.regulation = promoteSource.regulation ?? null;
      if (Object.keys(sync).length > 0) batch.update(collegeRef.collection("sections").doc(targetSection.id), { ...sync, updatedAt: now });
    }

    await batch.commit();

    // A graduate no longer has portal access. Disabled, not deleted - undoing a
    // graduation (students/[id] PATCH) turns it back on. A failure here must not
    // undo the graduation; it is counted and logged so it can be retried.
    let loginDeactivationFailures = 0;
    if (graduatedUids.length > 0) {
      const adminAuth = await getAdminAuth();
      for (let i = 0; i < graduatedUids.length; i += 5) {
        const results = await Promise.allSettled(
          graduatedUids.slice(i, i + 5).map((uid) => setStudentLoginActive(db, adminAuth, session.collegeId, uid, false))
        );
        loginDeactivationFailures += results.filter((r) => r.status === "rejected").length;
      }
      if (loginDeactivationFailures > 0) {
        console.error(`[college/students/promote] ${loginDeactivationFailures} graduate login(s) could not be disabled`);
      }
    }

    const performedByName = await getUserName(db, session.collegeId, session.uid);
    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: body.action === "GRADUATE" ? "STUDENT_GRADUATED" : "STUDENT_PROMOTED",
      performedBy: session.uid,
      performedByName,
      details: {
        count: updatedCount,
        skipped: skipped.length,
        ...(loginDeactivationFailures > 0 ? { loginDeactivationFailures } : {}),
        ...(targetSection ? { toSectionId: targetSection.id, toDepartment: targetSection.department, toYear: targetSection.year } : {}),
      },
      timestamp: now,
    });

    return NextResponse.json({ ok: true, updatedCount, skipped, skippedReasons, loginDeactivationFailures });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/promote POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
