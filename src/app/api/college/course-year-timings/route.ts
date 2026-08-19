export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartmentId } from "@/lib/departments/scope";
import { isTimetableIncharge } from "@/lib/departments/timetableIncharge";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import type { BreakConfig, CourseYearTiming, PeriodTiming } from "@/types";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE", "ACCOUNTS", "PANEL_MEMBER", "COLLEGE_STAFF");
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
    // COLLEGE_OFFICE sets these day-shape bounds too (see college-office/
    // timings/page.tsx) - the finer-grained HOD period-by-period breakdown
    // below (PATCH) stays HOD/Principal-only, a separate privilege.
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
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
      // As many entries as this course-year actually runs (Office/Principal
      // decides the count, not fixed at 2) - "YYYY-MM-DD" strings, converted
      // to Dates below before storage.
      semesters?: { semester?: number; startDate?: string; endDate?: string }[];
    };

    const {
      departmentId, courseId, year, collegeStartTime, collegeEndTime,
      numberOfPeriods, periodDurationMinutes, lunchBreak, shortBreaks,
    } = body;

    if (!departmentId || !courseId || !year || !collegeStartTime || !collegeEndTime || !numberOfPeriods || !periodDurationMinutes) {
      return NextResponse.json({ error: "Missing required timing fields" }, { status: 400 });
    }

    let semesters: { semester: number; startDate: Date; endDate: Date }[] = [];
    try {
      semesters = (body.semesters ?? []).map((s) => {
        if (!s.semester || s.semester < 1) throw new Error("Each semester needs a valid number (1, 2, 3, …)");
        if (!s.startDate || !s.endDate) throw new Error(`Semester ${s.semester}: both a start and end date are required`);
        const start = new Date(s.startDate);
        const end = new Date(s.endDate);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error(`Semester ${s.semester}: invalid date`);
        if (end < start) throw new Error(`Semester ${s.semester}: end date must be after the start date`);
        return { semester: s.semester, startDate: start, endDate: end };
      });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid semester dates" }, { status: 400 });
    }
    semesters.sort((a, b) => a.semester - b.semester);
    const semesterNumbers = semesters.map((s) => s.semester);
    if (new Set(semesterNumbers).size !== semesterNumbers.length) {
      return NextResponse.json({ error: "Each semester number must be unique" }, { status: 400 });
    }
    // Ranges must not overlap, in semester-number order - resolveCurrentSemester
    // (lib/college/semester.ts) walks them assuming non-overlapping ranges, and
    // an overlap would make "which semester is it" genuinely ambiguous for the
    // timetable to key off of.
    for (let i = 1; i < semesters.length; i++) {
      if (semesters[i].startDate < semesters[i - 1].endDate) {
        return NextResponse.json(
          { error: `Semester ${semesters[i].semester} must start on or after Semester ${semesters[i - 1].semester} ends` },
          { status: 400 },
        );
      }
    }

    const db = getAdminDb();
    const now = new Date();
    const docId = `${courseId}_year${year}`;
    const ref = db.collection("colleges").doc(session.collegeId).collection("courseYearTimings").doc(docId);
    const existing = await ref.get();
    const existingData = existing.data() as CourseYearTiming | undefined;

    const nextNumberOfPeriods = Number(numberOfPeriods);
    const nextPeriodDurationMinutes = Number(periodDurationMinutes);
    const nextLunchBreak = lunchBreak ?? null;
    const nextShortBreaks = shortBreaks ?? [];

    // The HOD's own period-by-period breakdown (`periods`, see PATCH below)
    // stores explicit clock times, independent of this formula - so if it
    // already exists and the Principal then changes the day's shape here
    // (a break moved/grew, period count/length changed, or the day's outer
    // bounds shifted), those stored times silently stop lining up with the
    // new breaks instead of shifting to match. Regenerate from the plain
    // formula whenever a shape-relevant field actually changes, so the grid
    // never shows a period's old clock time next to a break that's since
    // moved - matches defaultPeriodTimings' own note that it's "a reasonable
    // guess", now kept current instead of only seeded once.
    const shapeChanged = !existingData || (
      existingData.collegeStartTime !== collegeStartTime ||
      existingData.collegeEndTime !== collegeEndTime ||
      existingData.numberOfPeriods !== nextNumberOfPeriods ||
      existingData.periodDurationMinutes !== nextPeriodDurationMinutes ||
      JSON.stringify(existingData.lunchBreak ?? null) !== JSON.stringify(nextLunchBreak) ||
      JSON.stringify(existingData.shortBreaks ?? []) !== JSON.stringify(nextShortBreaks)
    );
    const hadPeriods = Boolean(existingData?.periods?.length);

    await ref.set({
      collegeId: session.collegeId,
      departmentId,
      courseId,
      year: Number(year),
      collegeStartTime,
      collegeEndTime,
      numberOfPeriods: nextNumberOfPeriods,
      periodDurationMinutes: nextPeriodDurationMinutes,
      lunchBreak: nextLunchBreak,
      shortBreaks: nextShortBreaks,
      // Always overwritten with the full submitted list (never merged
      // per-entry) so removing a semester in the form actually removes it
      // here too, instead of surviving because only the others were sent.
      semesters,
      updatedAt: now,
      ...(existing.exists ? {} : { createdAt: now }),
      ...(shapeChanged && hadPeriods
        ? {
            periods: defaultPeriodTimings({
              collegeStartTime,
              numberOfPeriods: nextNumberOfPeriods,
              periodDurationMinutes: nextPeriodDurationMinutes,
              lunchBreak: nextLunchBreak,
              shortBreaks: nextShortBreaks,
            }),
          }
        : {}),
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
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF");
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
    } else if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
      const ok = await isTimetableIncharge(db, session.collegeId, session.uid, courseId, year);
      if (!ok) {
        return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
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

    // Consecutive periods aren't required to be back-to-back (checked above,
    // that's just "no overlap") - but wherever the Principal placed a break,
    // this breakdown must actually leave room for it, otherwise the grid ends
    // up interleaving a "Lunch Break" row between two periods with no gap
    // between their clock times at all.
    const breaks = [
      ...(existing.lunchBreak ? [existing.lunchBreak] : []),
      ...(existing.shortBreaks ?? []),
    ];
    for (const brk of breaks) {
      const before = periods.find((p) => p.period === brk.afterPeriod);
      const after = periods.find((p) => p.period === brk.afterPeriod + 1);
      if (!before || !after) continue;
      if (toMinutes(after.startTime) < toMinutes(before.endTime) + brk.durationMinutes) {
        return NextResponse.json(
          { error: `Period ${after.period} must start at least ${brk.durationMinutes} min after period ${before.period} ends, to leave room for the break` },
          { status: 400 },
        );
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
