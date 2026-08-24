export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { parseAcademicYearStart } from "@/lib/college/academicSession";
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
// "advance": every ACTIVE faculty member with a teaching assignment in this course-year
// gets experienceYears and internalExperience bumped by 1.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      departmentId: string;
      courseId: string;
      year: number;
      label: string;
    };

    const { departmentId, courseId, year, label } = body;

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
    if (isAdvance && fromLabel) {
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

    if (isAdvance) {
      const assignmentsSnap = await collegeRef
        .collection("teachingAssignments")
        .where("courseId", "==", courseId)
        .where("year", "==", Number(year))
        .get();

      const facultyIds = Array.from(new Set(assignmentsSnap.docs.map((d) => (d.data() as { facultyId?: string }).facultyId).filter((id): id is string => !!id)));

      const batch = db.batch();

      for (const facultyId of facultyIds) {
        const facultyRef = collegeRef.collection("facultyMembers").doc(facultyId);
        const facultySnap = await facultyRef.get();
        if (!facultySnap.exists) continue;
        const facultyData = facultySnap.data() as { status?: FacultyStatus; experienceYears?: number; internalExperience?: number };
        if (facultyData.status !== "ACTIVE") continue;

        batch.update(facultyRef, {
          experienceYears: (facultyData.experienceYears ?? 0) + 1,
          internalExperience: (facultyData.internalExperience ?? 0) + 1,
          updatedAt: now,
        });
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

    return NextResponse.json({ id: docId, advanced: isAdvance, facultyUpdated }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/course-academic-years POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
