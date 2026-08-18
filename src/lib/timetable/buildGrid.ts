import type { CourseYearTiming, PeriodTiming } from "@/types";

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function toHHMM(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// A starting point for the HOD's period-by-period editor (see the Edit
// Period Timings dialog on the Timetable page) - walks the plain
// numberOfPeriods/periodDurationMinutes formula from collegeStartTime,
// inserting lunch/short break gaps, so an HOD breaking down a course-year for
// the first time starts from a reasonable guess instead of a blank list.
export function defaultPeriodTimings(
  timing: Pick<CourseYearTiming, "collegeStartTime" | "numberOfPeriods" | "periodDurationMinutes" | "lunchBreak" | "shortBreaks">,
): PeriodTiming[] {
  const periods: PeriodTiming[] = [];
  let cursor = toMinutes(timing.collegeStartTime);
  for (let p = 1; p <= timing.numberOfPeriods; p++) {
    const start = cursor;
    const end = start + timing.periodDurationMinutes;
    periods.push({ period: p, startTime: toHHMM(start), endTime: toHHMM(end) });
    cursor = end;
    if (timing.lunchBreak?.afterPeriod === p) cursor += timing.lunchBreak.durationMinutes;
    for (const sb of timing.shortBreaks ?? []) {
      if (sb.afterPeriod === p) cursor += sb.durationMinutes;
    }
  }
  return periods;
}

// Shared shape of a rendered timetable column: teaching periods interleaved with
// the lunch/short breaks configured on the course-year timing. Extracted from
// hod/timetable/[courseId]/[year]/[sectionId]/page.tsx so the grid the solver
// places into and the grid the UI draws can never drift apart.

export type TimetableRow =
  // startTime/endTime are only present once an HOD has broken this
  // course-year's day down period-by-period (see CourseYearTiming.periods) -
  // absent for a course-year still running on the plain numberOfPeriods/
  // periodDurationMinutes formula, which never carried real clock times.
  | { kind: "period"; period: number; startTime?: string; endTime?: string }
  | { kind: "lunch"; durationMinutes: number }
  | { kind: "short"; durationMinutes: number };

export function buildRows(timing: CourseYearTiming): TimetableRow[] {
  const rows: TimetableRow[] = [];
  const periodTimes = new Map((timing.periods ?? []).map((p) => [p.period, p]));
  for (let p = 1; p <= timing.numberOfPeriods; p++) {
    const pt = periodTimes.get(p);
    rows.push({ kind: "period", period: p, startTime: pt?.startTime, endTime: pt?.endTime });
    if (timing.lunchBreak?.afterPeriod === p) {
      rows.push({ kind: "lunch", durationMinutes: timing.lunchBreak.durationMinutes });
    }
    for (const sb of timing.shortBreaks ?? []) {
      if (sb.afterPeriod === p) rows.push({ kind: "short", durationMinutes: sb.durationMinutes });
    }
  }
  return rows;
}

/** Period numbers 1..numberOfPeriods — the placeable slots in a single day. */
export function periodNumbers(timing: CourseYearTiming): number[] {
  return Array.from({ length: timing.numberOfPeriods }, (_, i) => i + 1);
}

/**
 * Period numbers immediately followed by a break. A lab block may not span one
 * of these unless rules.allowLabAcrossBreaks is on, since the class would be
 * interrupted partway through.
 */
export function periodsFollowedByBreak(timing: CourseYearTiming): Set<number> {
  const breaks = new Set<number>();
  if (timing.lunchBreak?.afterPeriod) breaks.add(timing.lunchBreak.afterPeriod);
  for (const sb of timing.shortBreaks ?? []) {
    if (sb.afterPeriod) breaks.add(sb.afterPeriod);
  }
  return breaks;
}

/**
 * True when periods [start, start+size-1] are all real periods within the day
 * and (unless allowed) contain no break boundary.
 */
export function isContiguousBlockAvailable(
  timing: CourseYearTiming,
  start: number,
  size: number,
  allowAcrossBreaks: boolean,
): boolean {
  if (start < 1 || start + size - 1 > timing.numberOfPeriods) return false;
  if (allowAcrossBreaks) return true;
  const breaks = periodsFollowedByBreak(timing);
  // A break after the block's last period is fine - only interior ones split it.
  for (let p = start; p < start + size - 1; p++) {
    if (breaks.has(p)) return false;
  }
  return true;
}
