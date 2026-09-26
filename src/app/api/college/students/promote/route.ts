export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import type { Firestore } from "firebase-admin/firestore";
import { sectionParityGap, describeSectionParityGap } from "@/lib/college/sectionParity";
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

    const now = new Date();
    const batch = new ChunkedBatch(db);
    let updatedCount = 0;
    const skipped: string[] = [];

    for (const snap of studentSnaps) {
      if (!snap.exists) {
        skipped.push(snap.id);
        continue;
      }
      const student = snap.data() as StudentRecord;
      if (student.status !== "REGULAR") {
        skipped.push(snap.id);
        continue;
      }

      if (body.action === "GRADUATE") {
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
      } else {
        batch.update(snap.ref, {
          department: targetSection!.department,
          year: targetSection!.year,
          section: targetSection!.name,
          // Clear it: if this promotion is exactly a student's pre-registered
          // secondary department becoming their new primary one, a leftover
          // secondaryDepartment would be redundant (and stale/misleading if
          // it was ever anything else, e.g. corrected mid-way).
          secondaryDepartment: null,
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
      return NextResponse.json({ error: "No eligible (REGULAR) students to update" }, { status: 400 });
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

    const performedByName = await getUserName(db, session.collegeId, session.uid);
    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: body.action === "GRADUATE" ? "STUDENT_GRADUATED" : "STUDENT_PROMOTED",
      performedBy: session.uid,
      performedByName,
      details: {
        count: updatedCount,
        skipped: skipped.length,
        ...(targetSection ? { toSectionId: targetSection.id, toDepartment: targetSection.department, toYear: targetSection.year } : {}),
      },
      timestamp: now,
    });

    return NextResponse.json({ ok: true, updatedCount, skipped });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/promote POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
