import type { CourseYearTiming } from "@/types";

// Shared shape of a rendered timetable column: teaching periods interleaved with
// the lunch/short breaks configured on the course-year timing. Extracted from
// hod/timetable/[courseId]/[year]/[sectionId]/page.tsx so the grid the solver
// places into and the grid the UI draws can never drift apart.

export type TimetableRow =
  | { kind: "period"; period: number }
  | { kind: "lunch"; durationMinutes: number }
  | { kind: "short"; durationMinutes: number };

export function buildRows(timing: CourseYearTiming): TimetableRow[] {
  const rows: TimetableRow[] = [];
  for (let p = 1; p <= timing.numberOfPeriods; p++) {
    rows.push({ kind: "period", period: p });
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
