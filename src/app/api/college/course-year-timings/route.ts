export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartmentId, facultyManageableDepartmentNames } from "@/lib/departments/scope";
import { isTimetableIncharge } from "@/lib/departments/timetableIncharge";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import { getFreshmanDepartmentIds, structureFromDepartments } from "@/lib/college/academicStructure";
import { inheritedTimingCourseId } from "@/lib/timetable/sharedYearTiming";
import type { BreakConfig, Course, CourseYearTiming, Department, PeriodTiming } from "@/types";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE", "ACCOUNTS", "PANEL_MEMBER", "COLLEGE_STAFF", "ACADEMICS", "EXAM_CELL");
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");

    const db = getAdminDb();
    let query = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("courseYearTimings") as FirebaseFirestore.Query;

    if (courseId) query = query.where("courseId", "==", courseId);

    const snap = await query.get();
    let timings = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as (CourseYearTiming & { id: string })[];

    // Read access scoped the same way PATCH already restricts writes below -
    // an HOD may only see their own department's (or a sub-department's/
    // managed branch's) course-year timings, never an arbitrary department's.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      const ownedTimings = timings.filter((t) => canHodEditDepartmentId(scope, t.departmentId));
      const deniedTimings = timings.filter((t) => !canHodEditDepartmentId(scope, t.departmentId));

      // A lending HOD deep-linked here via a fulfilled Assignment Request
      // (their own faculty placed to teach a subject on ANOTHER department's
      // section - see AssignmentRequestsPanel's "Place on timetable") has no
      // edit rights over that department, but still needs the college-day
      // timing that governs the grid they were sent to, or the editor can
      // never render for them at all. Narrowed the same way
      // canHodManageAssignment's ownsFaculty fallback is: only a course-year
      // where this HOD's OWN faculty roster already holds a real
      // TeachingAssignment unlocks that row - department membership itself
      // grants nothing here.
      if (deniedTimings.length > 0 && courseId) {
        const rosterDeptNames = facultyManageableDepartmentNames(scope);
        const rosterFacultySnap = rosterDeptNames.length > 0
          ? await db.collection("colleges").doc(session.collegeId).collection("facultyMembers")
              .where("department", "in", rosterDeptNames.slice(0, 30)).get()
          : null;
        const rosterIds = new Set((rosterFacultySnap?.docs ?? []).map((d) => d.id));
        if (rosterIds.size > 0) {
          const taSnap = await db.collection("colleges").doc(session.collegeId)
            .collection("teachingAssignments").where("courseId", "==", courseId).get();
          const accessibleYears = new Set(
            taSnap.docs
              .filter((d) => rosterIds.has((d.data() as { facultyId?: string }).facultyId ?? ""))
              .map((d) => Number((d.data() as { year?: number }).year))
          );
          for (const t of deniedTimings) {
            if (accessibleYears.has(Number(t.year))) ownedTimings.push(t);
          }
        }

        // A lending department marking busy periods (AssignmentRequestsPanel)
        // picks ANY year of the requesting course - the faculty's own commitment
        // can be in a different year than the request - so the per-year
        // assignment rule above left every other year unconfigured. Having an
        // ALLOCATED request for this course targeted at the HOD's own
        // department unlocks the course's remaining rows (read-only; PATCH
        // still enforces edit scope). Filtered in memory to avoid a composite index.
        const alreadyOwned = new Set(ownedTimings.map((t) => t.id));
        const lendNames = new Set(rosterDeptNames);
        const lentSnap = await db.collection("colleges").doc(session.collegeId)
          .collection("facultyAssignmentRequests")
          .where("courseId", "==", courseId).where("status", "==", "ALLOCATED").get();
        const isLender = lentSnap.docs.some((d) => lendNames.has((d.data() as { targetDepartmentName?: string }).targetDepartmentName ?? ""));
        if (isLender) {
          for (const t of deniedTimings) if (!alreadyOwned.has(t.id)) ownedTimings.push(t);
        }
      }

      timings = ownedTimings;
    }

    // A shared first year is configured once, on the common department that
    // runs it (e.g. Basic Science), but a section routed to a managed branch
    // asks by the BRANCH's course id - which has no row of its own for that
    // year. Add the owning course's row for any such year so the timetable
    // editor sees the timings that actually govern it. Only years a manager
    // genuinely owns are filled in (see inheritedTimingCourseId), so a
    // department merely missing its own year stays unconfigured, as before.
    if (courseId) {
      const collegeRef = db.collection("colleges").doc(session.collegeId);
      const [coursesSnap, deptsSnap, allTimingsSnap] = await Promise.all([
        collegeRef.collection("courses").get(),
        collegeRef.collection("departments").get(),
        collegeRef.collection("courseYearTimings").get(),
      ]);
      const courses = coursesSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Course[];
      const departments = deptsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as (Department & { id: string })[];
      const ownCourse = courses.find((c) => c.id === courseId);
      if (ownCourse) {
        const allTimings = allTimingsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as (CourseYearTiming & { id: string })[];
        const haveYears = new Set(timings.map((t) => Number(t.year)));
        const span = Number(ownCourse.durationYears) || 0;
        for (let year = 1; year <= span; year++) {
          if (haveYears.has(year)) continue;
          const inheritedId = inheritedTimingCourseId(ownCourse, year, departments, courses);
          if (!inheritedId) continue;
          const inherited = allTimings.find((t) => t.courseId === inheritedId && Number(t.year) === year);
          // Reported under the course that was asked for, with its own id kept
          // so a later edit still writes to the row it came from rather than
          // silently forking a copy.
          if (inherited) timings.push({ ...inherited, inheritedFromCourseId: inheritedId } as typeof inherited);
          haveYears.add(year);
        }

        // Common first year: the Principal configures it ONCE on the shared
        // (freshman) department and it governs every course's year 1 - a branch
        // that isn't a managed branch of any sub-department (so
        // inheritedTimingCourseId above finds nothing) has no row of its own
        // for it. Fall back to the shared department's row for any year it
        // claims, preferring the same catalog programme. Read-only view of the
        // shared row; edits still write to the row it came from.
        const structure = structureFromDepartments(departments);
        if (structure.isCommonFirstYear) {
          const commonIds = getFreshmanDepartmentIds(departments);
          const sharedDeptIds = new Set(
            departments.filter((d) => commonIds.has(d.id) || (d.parentDepartmentId && commonIds.has(d.parentDepartmentId))).map((d) => d.id)
          );
          const courseById = new Map(courses.map((c) => [c.id, c]));
          for (const year of structure.commonYears) {
            if (year < 1 || year > span || haveYears.has(year)) continue;
            const candidates = allTimings.filter((t) => Number(t.year) === year && sharedDeptIds.has(t.departmentId));
            if (candidates.length === 0) continue;
            const shared =
              candidates.find((t) => ownCourse.catalogId && courseById.get(t.courseId)?.catalogId === ownCourse.catalogId) ??
              candidates[0];
            timings.push({ ...shared, inheritedFromCourseId: shared.courseId } as typeof shared);
            haveYears.add(year);
          }
        }
      }
    }

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
    if (!TIME_RE.test(collegeStartTime) || !TIME_RE.test(collegeEndTime)) {
      return NextResponse.json({ error: "Enter valid College Start/End times" }, { status: 400 });
    }

    const availableMinutes = toMinutes(collegeEndTime) - toMinutes(collegeStartTime);
    if (availableMinutes <= 0) {
      return NextResponse.json({ error: "College End Time must be after College Start Time" }, { status: 400 });
    }
    // Same total as defaultPeriodTimings below sums while laying periods out
    // end-to-end, checked up front so a day that can never fit isn't stored
    // at all - not even the client's own submit guard can be relied on here,
    // since COLLEGE_OFFICE can also POST this directly.
    const breaksTotal = (lunchBreak?.durationMinutes || 0) + (shortBreaks ?? []).reduce((sum, sb) => sum + (sb.durationMinutes || 0), 0);
    const requiredMinutes = Number(numberOfPeriods) * Number(periodDurationMinutes) + breaksTotal;
    if (requiredMinutes > availableMinutes) {
      const fmt = (mins: number) => `${Math.floor(mins / 60)}h ${mins % 60}m`;
      return NextResponse.json(
        { error: `Periods and breaks need ${fmt(requiredMinutes)}, but only ${fmt(availableMinutes)} is available between ${collegeStartTime} and ${collegeEndTime}` },
        { status: 400 },
      );
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

    // Semester date ranges must not run outside the college's current
    // academic session, when the Principal has actually set that session's
    // own dates (AcademicSession.startDate/endDate - optional; see that
    // type's own doc-comment on why most consumers deliberately don't
    // compare on it, `label` being the real interop key there. This check is
    // the exception: a semester dated into the wrong academic year by
    // mistake is exactly the kind of gap this route's own overlap/ordering
    // checks above exist to catch, and this is the one boundary they never
    // covered). Skipped entirely when no current session has both dates set,
    // same leniency every other "optional config, don't block on it" check
    // in this codebase already gives.
    if (semesters.length > 0) {
      const currentSessionSnap = await db.collection("colleges").doc(session.collegeId)
        .collection("academicSessions").where("isCurrent", "==", true).limit(1).get();
      const currentSession = currentSessionSnap.docs[0]?.data() as
        { label?: string; startDate?: string; endDate?: string } | undefined;
      if (currentSession?.startDate && currentSession?.endDate) {
        const sessionStart = new Date(currentSession.startDate);
        const sessionEnd = new Date(currentSession.endDate);
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        for (const s of semesters) {
          if (s.startDate < sessionStart || s.endDate > sessionEnd) {
            return NextResponse.json(
              {
                error: `Semester ${s.semester} (${fmt(s.startDate)} to ${fmt(s.endDate)}) must fall within the ${currentSession.label ?? "current"} academic year (${currentSession.startDate} to ${currentSession.endDate})`,
              },
              { status: 400 },
            );
          }
        }
      }
    }

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
