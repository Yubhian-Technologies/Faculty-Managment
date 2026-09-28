export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { parseAcademicYearStart } from "@/lib/college/academicSession";
import { isFacultyAvailable } from "@/types";
import type { FacultyStatus } from "@/types";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE");
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");

    const db = getAdminDb();
    let query = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("courseAcademicYears") as FirebaseFirestore.Query;

    if (courseId) query = query.where("courseId", "==", courseId);

    const snap = await query.get();
    const academicYears = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ academicYears });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/course-academic-years GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Upsert - one doc per (courseId, year). First call for a course-year just records
// the label (no side effects). A call against an *existing* doc is treated as an
// "advance", logged to the audit trail with a count of every ACTIVE faculty
// member who has a teaching assignment in this course-year - unless `correction`
// is set, which means a Principal is fixing a mistaken label (e.g. picked a
// future year by accident): the forward-only guard is skipped and it's logged
// as ACADEMIC_YEAR_CORRECTED instead of ACADEMIC_YEAR_ADVANCED, so the audit
// trail still tells the two apart.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      departmentId: string;
      courseId: string;
      year: number;
      label: string;
      correction?: boolean;
    };

    const { departmentId, courseId, year, label, correction } = body;

    if (!departmentId || !courseId || !year || !label?.trim()) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    const labelStart = parseAcademicYearStart(label);
    if (labelStart == null) {
      return NextResponse.json({ error: `Academic year label must be a year range like "2025-2026", got "${label}"` }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const now = new Date();
    const docId = `${courseId}_year${year}`;
    const ref = collegeRef.collection("courseAcademicYears").doc(docId);
    const existing = await ref.get();
    const isAdvance = existing.exists;
    const fromLabel = isAdvance ? (existing.data() as { label?: string }).label ?? "" : null;

    // Reject a backwards move (never require exactly +1 though - a Principal
    // may legitimately skip a year they missed advancing, see this route's
    // own top comment). If the EXISTING label itself doesn't parse (legacy
    // free text), there's nothing sane to compare against, so this is
    // skipped entirely rather than blocking every future advance on it.
    // A `correction` save is exempt outright - it exists specifically to
    // undo a mistaken forward move, so it must be allowed to go backward.
    if (isAdvance && fromLabel && !correction) {
      const fromStart = parseAcademicYearStart(fromLabel);
      if (fromStart != null && labelStart < fromStart) {
        return NextResponse.json({ error: `"${label}" is earlier than the current "${fromLabel}" - an academic year can only move forward.` }, { status: 400 });
      }
    }

    let actorName = "Unknown";
    try {
      const actorSnap = await collegeRef.collection("users").doc(session.uid).get();
      actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    } catch { /* best-effort */ }

    let facultyUpdated = 0;

    if (isAdvance && correction) {
      // A correction never counts as progressing the course-year, so it skips
      // the faculty tally (nothing genuinely advanced) and records its own
      // audit action rather than ACADEMIC_YEAR_ADVANCED, so the trail still
      // shows this was a fix, not a real forward move.
      await collegeRef.collection("auditLogs").doc().set({
        collegeId: session.collegeId,
        action: "ACADEMIC_YEAR_CORRECTED",
        performedBy: session.uid,
        performedByName: actorName,
        targetId: docId,
        details: { courseId, year: Number(year), fromLabel, toLabel: label },
        timestamp: now,
      });

      await ref.set({
        collegeId: session.collegeId,
        departmentId,
        courseId,
        year: Number(year),
        label,
        correctedAt: now,
        correctedByName: actorName,
        updatedAt: now,
      }, { merge: true });
    } else if (isAdvance) {
      const assignmentsSnap = await collegeRef
        .collection("teachingAssignments")
        .where("courseId", "==", courseId)
        .where("year", "==", Number(year))
        .get();

      const facultyIds = Array.from(new Set(assignmentsSnap.docs.map((d) => (d.data() as { facultyId?: string }).facultyId).filter((id): id is string => !!id)));

      const batch = db.batch();

      // Total/Internal/External Years of Experience are all computed live
      // from joiningDate + the Academic/Industry/Research Experience entries
      // wherever shown (see experienceCalc.ts) - nothing needs bumping here
      // just because a course-year advanced; this loop now only counts how
      // many ACTIVE faculty had a teaching assignment in it, for the audit log.
      for (const facultyId of facultyIds) {
        const facultySnap = await collegeRef.collection("facultyMembers").doc(facultyId).get();
        if (!facultySnap.exists) continue;
        const facultyData = facultySnap.data() as { status?: FacultyStatus };
        if (!isFacultyAvailable(facultyData.status)) continue;
        facultyUpdated++;
      }

      batch.set(ref, {
        collegeId: session.collegeId,
        departmentId,
        courseId,
        year: Number(year),
        label,
        advancedAt: now,
        advancedByName: actorName,
        updatedAt: now,
      }, { merge: true });

      batch.set(collegeRef.collection("auditLogs").doc(), {
        collegeId: session.collegeId,
        action: "ACADEMIC_YEAR_ADVANCED",
        performedBy: session.uid,
        performedByName: actorName,
        targetId: docId,
        details: { courseId, year: Number(year), fromLabel, toLabel: label, facultyCount: facultyUpdated },
        timestamp: now,
      });

      await batch.commit();
    } else {
      await ref.set({
        collegeId: session.collegeId,
        departmentId,
        courseId,
        year: Number(year),
        label,
        createdAt: now,
        updatedAt: now,
      });
    }

    return NextResponse.json({ id: docId, advanced: isAdvance && !correction, corrected: isAdvance && !!correction, facultyUpdated }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/course-academic-years POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
