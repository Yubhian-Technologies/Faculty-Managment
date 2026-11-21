import { istDateKey } from "@/lib/attendance/istTime";

// Which part of a day a leave covers - the ONE answer every "is this person away at this time" check uses (substitute
// periods, check-in, the attendance mark on approval, dashboards, Free Faculty, invigilation, class adjustments, the
// leave register). A day splits at 1 PM: the forenoon is before 13:00 (a period counts as forenoon when it STARTS
// before 13:00), the afternoon from 13:00.
//   - a single-day half day (isHalfDay + halfDaySession) covers that half;
//   - a range covers whole days, except its first day when firstDayHalf = "AN" (afternoon only) and its last day when
//     lastDayHalf = "FN" (forenoon only).

export const HALF_DAY_SPLIT = "13:00";
export type LeaveDayPart = "FULL" | "FN" | "AN";

type Stamp = Date | string | { toDate(): Date } | null | undefined;
export interface LeaveSpan {
  fromDate?: Stamp;
  toDate?: Stamp;
  isHalfDay?: boolean;
  halfDaySession?: "FN" | "AN" | null;
  firstDayHalf?: "AN" | null;
  lastDayHalf?: "FN" | null;
}

/** "YYYY-MM-DD" (India) of a stored leave date: a Timestamp / Date read as an instant, a "YYYY-MM-DD" string as is. */
export function leaveDateKey(v: Stamp): string {
  if (!v) return "";
  if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : istDateKey(new Date(v));
  const d = v instanceof Date ? v : typeof (v as { toDate?: unknown }).toDate === "function" ? (v as { toDate(): Date }).toDate() : null;
  return d ? istDateKey(d) : "";
}

/** The part of `dateISO` ("YYYY-MM-DD") the leave covers, or null when it doesn't cover that date. */
export function leavePartOn(req: LeaveSpan, dateISO: string): LeaveDayPart | null {
  const from = leaveDateKey(req.fromDate), to = leaveDateKey(req.toDate);
  if (!from || !to || dateISO < from || dateISO > to) return null;
  if (req.isHalfDay) return req.halfDaySession === "AN" ? "AN" : "FN";
  if (from !== to) {
    if (dateISO === from && req.firstDayHalf === "AN") return "AN";
    if (dateISO === to && req.lastDayHalf === "FN") return "FN";
  }
  return "FULL";
}

/** Whether a part covers a moment / period starting at `hhmm` ("HH:MM"). No time = the whole day's question. */
export function partCovers(part: LeaveDayPart | null, hhmm?: string | null): boolean {
  if (!part) return false;
  if (part === "FULL" || !hhmm) return true;
  return part === "FN" ? hhmm < HALF_DAY_SPLIT : hhmm >= HALF_DAY_SPLIT;
}

/** The leave's clock range on that date ("00:00"-"13:00" forenoon, "13:00"-"23:59" afternoon), or null. */
export function leaveRangeOn(req: LeaveSpan, dateISO: string): { from: string; to: string; part: LeaveDayPart } | null {
  const part = leavePartOn(req, dateISO);
  if (!part) return null;
  return part === "FN" ? { from: "00:00", to: HALF_DAY_SPLIT, part } : part === "AN" ? { from: HALF_DAY_SPLIT, to: "23:59", part } : { from: "00:00", to: "23:59", part };
}

/** "27/11/2026 forenoon only" style note for a range's half-day ends (empty when none). */
export function halfEndsNote(req: LeaveSpan, fmt: (iso: string) => string): string {
  const from = leaveDateKey(req.fromDate), to = leaveDateKey(req.toDate);
  if (!from || !to || from === to) return "";
  const parts: string[] = [];
  if (req.firstDayHalf === "AN") parts.push(`${fmt(from)} afternoon only`);
  if (req.lastDayHalf === "FN") parts.push(`${fmt(to)} forenoon only`);
  return parts.join(", ");
}
