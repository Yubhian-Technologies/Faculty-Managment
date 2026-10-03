import type { Firestore } from "firebase-admin/firestore";
import type { Course, CourseYearTiming, Department } from "@/types";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import { inheritedTimingCourseId } from "@/lib/timetable/sharedYearTiming";

// ONE rule for "is this faculty member in two places at once", used by the
// draft editor (lib/timetable/draftPlacement.ts), the direct slot routes
// (teaching-assignments / timetable-slots POST) and publish. Before, they held
// three different opinions: the draft editor and the slot routes allowed the
// same faculty in two sections at the same PERIOD NUMBER (years run different
// timings, so the numbers needn't mean the same time), publish rejected it
// outright - and neither ever looked at the clock. So an HOD could build a full
// draft and be refused at publish, while a real overlap between two years with
// different timings (Year 1 period 3 runs 10:40-11:30, Year 2 period 2 runs
// 10:20-11:10) sailed through everywhere.
//
// Two placements clash when they are on the same day and their resolved clock
// intervals intersect. Touching end-to-start (11:30 / 11:30) is not a clash.
// When a placement's clock time cannot be resolved (its course-year has no
// timing) the rule falls back to the old publish behaviour - the same period
// number clashes - which is the conservative direction: it can refuse a
// placement it could not prove safe, never wave through one it could not check.

export interface TimedCell {
  day: string;
  periodNumber: number;
  courseId: string;
  year: number;
}

export type TimingLookup = (courseId: string, year: number) => CourseYearTiming | null;

export interface Interval { start: number; end: number }

const toMinutes = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Clock interval (minutes since midnight) of `period` under `timing`, or null when it can't be resolved. */
export function periodInterval(timing: CourseYearTiming | null | undefined, period: number): Interval | null {
  if (!timing) return null;
  // Same source of truth buildGrid.buildRows uses to draw the grid: the HOD's
  // period-by-period breakdown when there is one, else the formula.
  const source = timing.periods && timing.periods.length > 0 ? timing.periods : defaultPeriodTimings(timing);
  const row = source.find((p) => Number(p.period) === Number(period));
  if (!row) return null;
  const start = toMinutes(row.startTime);
  const end = toMinutes(row.endTime);
  return start != null && end != null && end > start ? { start, end } : null;
}

export function formatInterval(i: Interval): string {
  const f = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  return `${f(i.start)}-${f(i.end)}`;
}

export function cellsOverlap(a: TimedCell, b: TimedCell, lookup: TimingLookup): boolean {
  if (a.day !== b.day) return false;
  const ia = periodInterval(lookup(a.courseId, a.year), a.periodNumber);
  const ib = periodInterval(lookup(b.courseId, b.year), b.periodNumber);
  if (ia && ib) return ia.start < ib.end && ib.start < ia.end;
  return Number(a.periodNumber) === Number(b.periodNumber);
}

/** First of `others` that `cell` clashes with, or null. */
export function findOverlap<T extends TimedCell>(cell: TimedCell, others: Iterable<T>, lookup: TimingLookup): T | null {
  for (const o of others) if (cellsOverlap(cell, o, lookup)) return o;
  return null;
}

/** Human-readable "Mon 10:40-11:30" for a message, falling back to the period number. */
export function describeCell(cell: TimedCell, lookup: TimingLookup): string {
  const interval = periodInterval(lookup(cell.courseId, cell.year), cell.periodNumber);
  return `${cell.day} ${interval ? formatInterval(interval) : `period ${cell.periodNumber}`}`;
}

const keyOf = (courseId: string, year: number) => `${courseId}_${Number(year)}`;

/** Exact (courseId, year) match, plus an optional resolver for shared-first-year inheritance. */
export function timingLookupFrom(
  timings: CourseYearTiming[],
  inherited: ReadonlyMap<string, CourseYearTiming> = new Map()
): TimingLookup {
  const byKey = new Map(timings.map((t) => [keyOf(t.courseId, t.year), t]));
  return (courseId, year) => byKey.get(keyOf(courseId, year)) ?? inherited.get(keyOf(courseId, year)) ?? null;
}

/**
 * Loads every course-year timing and, only for the course-years in `needed`
 * that have none of their own, resolves the shared-first-year fallback the
 * timetable context already applies (a branch's section stores the BRANCH's
 * course id while the shared year's timing lives on the common department's
 * course - see sharedYearTiming.ts). Courses and departments are read only
 * when something is actually missing.
 */
export async function loadTimingLookup(
  db: Firestore,
  collegeId: string,
  needed: { courseId: string; year: number }[],
  preloaded?: CourseYearTiming[]
): Promise<{ lookup: TimingLookup; timings: CourseYearTiming[] }> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const timings = preloaded
    ?? (await collegeRef.collection("courseYearTimings").get()).docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as CourseYearTiming);
  const exact = timingLookupFrom(timings);
  const missing = needed.filter((n) => !exact(n.courseId, n.year));
  const inherited = new Map<string, CourseYearTiming>();
  if (missing.length > 0) {
    const [coursesSnap, deptsSnap] = await Promise.all([
      collegeRef.collection("courses").get(),
      collegeRef.collection("departments").get(),
    ]);
    const courses = coursesSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Course[];
    const departments = deptsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as (Department & { id: string })[];
    for (const m of missing) {
      const own = courses.find((c) => c.id === m.courseId);
      const inheritedId = own ? inheritedTimingCourseId(own, Number(m.year), departments, courses) : null;
      const t = inheritedId ? exact(inheritedId, m.year) : null;
      if (t) inherited.set(keyOf(m.courseId, m.year), t);
    }
  }
  return { lookup: timingLookupFrom(timings, inherited), timings };
}
