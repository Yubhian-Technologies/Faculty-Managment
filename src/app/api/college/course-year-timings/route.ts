export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartmentId } from "@/lib/departments/scope";
import type { BreakConfig, CourseYearTiming, PeriodTiming } from "@/types";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE", "ACCOUNTS", "PANEL_MEMBER");
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");

    const db = getAdminDb();
    let query = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("courseYearTimings") as FirebaseFirestore.Query;

    if (courseId) query = query.where("courseId", "==", courseId);

    const snap = await query.get();
    const timings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ timings });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/course-year-timings GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Upsert - one doc per (courseId, year)
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      departmentId: string;
      courseId: string;
      year: number;
      collegeStartTime: string;
      collegeEndTime: string;
      numberOfPeriods: number;
      periodDurationMinutes: number;
      lunchBreak: BreakConfig;
      shortBreaks: BreakConfig[];
    };

    const {
      departmentId, courseId, year, collegeStartTime, collegeEndTime,
      numberOfPeriods, periodDurationMinutes, lunchBreak, shortBreaks,
    } = body;

    if (!departmentId || !courseId || !year || !collegeStartTime || !collegeEndTime || !numberOfPeriods || !periodDurationMinutes) {
      return NextResponse.json({ error: "Missing required timing fields" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();
    const docId = `${courseId}_year${year}`;
    const ref = db.collection("colleges").doc(session.collegeId).collection("courseYearTimings").doc(docId);
    const existing = await ref.get();

    await ref.set({
      collegeId: session.collegeId,
      departmentId,
      courseId,
      year: Number(year),
      collegeStartTime,
      collegeEndTime,
      numberOfPeriods: Number(numberOfPeriods),
      periodDurationMinutes: Number(periodDurationMinutes),
      lunchBreak: lunchBreak ?? null,
      shortBreaks: shortBreaks ?? [],
      updatedAt: now,
      ...(existing.exists ? {} : { createdAt: now }),
    }, { merge: true });

    return NextResponse.json({ id: docId }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/course-year-timings POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// HOD-only: fills in the period-by-period breakdown (each period's own
// start/end clock time) within a course-year's college day, which the
// Principal already set via POST above (collegeStartTime/collegeEndTime) -
// this never touches those bounds or anything else Principal-owned, only
// `periods` (and numberOfPeriods, kept in lockstep with periods.length so
// isContiguousBlockAvailable/the timetable solver stay correct - see
// lib/timetable/buildGrid.ts). The record must already exist: an HOD breaks
// down a day the Principal has already bounded, they don't invent the bounds.
export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      courseId?: string;
      year?: number;
      periods?: PeriodTiming[];
    };
    const { courseId, year } = body;
    if (!courseId || !year || !Array.isArray(body.periods)) {
      return NextResponse.json({ error: "courseId, year and periods are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const docId = `${courseId}_year${year}`;
    const ref = db.collection("colleges").doc(session.collegeId).collection("courseYearTimings").doc(docId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json(
        { error: "Ask the Principal to set up this course-year's college day timings first" },
        { status: 404 },
      );
    }
    const existing = snap.data() as CourseYearTiming;

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartmentId(scope, existing.departmentId)) {
        return NextResponse.json({ error: "This course-year isn't in your department" }, { status: 403 });
      }
    }

    const periods = [...body.periods].sort((a, b) => a.period - b.period);
    if (periods.length === 0) {
      return NextResponse.json({ error: "Add at least one period" }, { status: 400 });
    }
    for (let i = 0; i < periods.length; i++) {
      const p = periods[i];
      if (p.period !== i + 1) {
        return NextResponse.json({ error: "Periods must be numbered 1, 2, 3, … with no gaps" }, { status: 400 });
      }
      if (!TIME_RE.test(p.startTime) || !TIME_RE.test(p.endTime)) {
        return NextResponse.json({ error: `Period ${p.period}: enter valid start/end times` }, { status: 400 });
      }
      if (p.endTime <= p.startTime) {
        return NextResponse.json({ error: `Period ${p.period}: end time must be after start time` }, { status: 400 });
      }
      if (p.startTime < existing.collegeStartTime || p.endTime > existing.collegeEndTime) {
        return NextResponse.json(
          { error: `Period ${p.period} falls outside the college day (${existing.collegeStartTime}–${existing.collegeEndTime})` },
          { status: 400 },
        );
      }
      if (i > 0 && p.startTime < periods[i - 1].endTime) {
        return NextResponse.json({ error: `Period ${p.period} overlaps period ${periods[i - 1].period}` }, { status: 400 });
      }
    }

    await ref.update({
      periods,
      numberOfPeriods: periods.length,
      updatedAt: new Date(),
    });

    return NextResponse.json({ id: docId });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/course-year-timings PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
