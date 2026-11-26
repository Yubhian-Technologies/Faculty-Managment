// Early check-out (faculty / staff self check-out before the college's End Time, Attendance Timings).
//
// Before the End Time a check-out needs a reason. A faculty member with classes still left today (a period that
// hasn't ended yet) must first cover each of them, by either:
//   - Adjust / Swap a Class: an open (PENDING or ACCEPTED) adjustment of that period. An ACCEPTED one already
//     drops the period out of their day (getFacultyPeriodsForDate), so only a PENDING one needs matching here.
//   - a Permission (pending or approved) whose time runs from when they leave until the period ends.
// A period inside an approved half-day leave is covered by the leave (its substitutes). Pure rules; the server
// side is lib/attendance/earlyCheckOutServer.ts. Not set End Time = no early check-out rule at all.

import { HALF_DAY_SPLIT, partCovers, type LeaveDayPart } from "@/lib/leave/leaveDayParts";

const toMin = (hhmm: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

export interface RemainingPeriod {
  slotId: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  subjectName: string;
  sectionId: string;
  sectionName: string;
  department: string;
  /** "HOW" it is covered, when it is. */
  coveredBy?: "ADJUSTMENT" | "PERMISSION" | "LEAVE";
}

export interface PermissionWindow { id: string; fromTime: string; toTime: string }

/** Periods not over yet at `now` ("HH:MM"): a class going on now counts too. Earliest first. */
export function periodsLeft<T extends { startTime: string; endTime: string }>(periods: T[], now: string): T[] {
  const n = toMin(now);
  return periods
    .filter((p) => Number.isFinite(toMin(p.endTime)) && toMin(p.endTime) > n)
    .sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
}

/** A permission covers a period when it starts by the time the person leaves (or the period starts, if later)
 *  and runs until the period ends. */
export function permissionCovers(p: Pick<PermissionWindow, "fromTime" | "toTime">, period: { startTime: string; endTime: string }, now: string): boolean {
  const from = Math.max(toMin(period.startTime), toMin(now));
  return toMin(p.fromTime) <= from && toMin(p.toTime) >= toMin(period.endTime);
}

export function markCoverage(
  left: Omit<RemainingPeriod, "coveredBy">[],
  ctx: { now: string; pendingAdjustedSlotIds: Set<string>; permissions: PermissionWindow[]; leavePart: LeaveDayPart | null },
): { periods: RemainingPeriod[]; permissionIds: string[] } {
  const used = new Set<string>();
  const periods = left.map((p): RemainingPeriod => {
    if (partCovers(ctx.leavePart, p.startTime)) return { ...p, coveredBy: "LEAVE" };
    if (ctx.pendingAdjustedSlotIds.has(p.slotId)) return { ...p, coveredBy: "ADJUSTMENT" };
    const perm = ctx.permissions.find((w) => permissionCovers(w, p, ctx.now));
    if (perm) { used.add(perm.id); return { ...p, coveredBy: "PERMISSION" }; }
    return { ...p };
  });
  return { periods, permissionIds: [...used] };
}

/** The day's closing time for this person: the college's End Time, or 13:00 on an afternoon (AN) leave. */
export function effectiveEndTime(endTime: string | null, leavePart: LeaveDayPart | null): string | null {
  if (!endTime) return null;
  if (leavePart === "AN" && toMin(HALF_DAY_SPLIT) < toMin(endTime)) return HALF_DAY_SPLIT;
  return endTime;
}

/** True when checking out at `now` is before the closing time. */
export function isEarly(now: string, closing: string | null): boolean {
  return !!closing && toMin(now) < toMin(closing);
}

export interface EarlyCheckOutState {
  /** The closing time in force today (null = not set: no rule). */
  closingTime: string | null;
  early: boolean;
  /** Classes still left today (each with how it is covered, when it is). Only when early. */
  periods: RemainingPeriod[];
  uncovered: RemainingPeriod[];
  permissionIds: string[];
  pendingAdjustmentIds: string[];
}

export const CLASSES_LEFT_MESSAGE = "You still have classes today. Adjust each class or apply for a permission before you check out.";
export const EARLY_REASON_MESSAGE = "You are checking out before the college's closing time. Enter a reason.";
