import type { Firestore } from "firebase-admin/firestore";
import { getFacultyPeriodsForDate, type FacultyPeriodOnDate } from "@/lib/timetable/currentPeriod";
import type { LabAttendanceAllocation, LabAttendanceDateRange } from "@/types";

// A lab's own faculty normally marks attendance only today and only inside the
// period window. An allocation (see LabAttendanceAllocation) lifts that for the
// date ranges an HOD / Sub-HOD / Timetable Incharge picked: on those dates the
// faculty can open the lab assignment's periods at any time of day, including
// dates already gone by. The published timetable still decides WHICH periods
// exist on a date (its weekday slots), and a holiday still closes the day.

export const COLLECTION = "labAttendanceAllocations";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_RANGES = 20;

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Validates and sorts a list of date ranges: real dates, from <= to, no overlaps. */
export function normalizeRanges(input: unknown): { ok: true; ranges: LabAttendanceDateRange[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "ranges must be a list of from/to dates" };
  if (input.length > MAX_RANGES) return { ok: false, error: `At most ${MAX_RANGES} date ranges` };
  const ranges: LabAttendanceDateRange[] = [];
  for (const r of input) {
    const from = typeof r?.from === "string" ? r.from.trim() : "";
    const to = typeof r?.to === "string" ? r.to.trim() : "";
    if (!isRealDate(from) || !isRealDate(to)) return { ok: false, error: "Every range needs a valid From and To date" };
    if (from > to) return { ok: false, error: `From date ${from} is after To date ${to}` };
    ranges.push({ from, to });
  }
  ranges.sort((a, b) => a.from.localeCompare(b.from));
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].from <= ranges[i - 1].to) {
      return { ok: false, error: `Date ranges ${ranges[i - 1].from}..${ranges[i - 1].to} and ${ranges[i].from}..${ranges[i].to} overlap` };
    }
  }
  return { ok: true, ranges };
}

export function dateInRanges(date: string, ranges: readonly LabAttendanceDateRange[] | undefined): boolean {
  return (ranges ?? []).some((r) => date >= r.from && date <= r.to);
}

/** The college's calendar day (IST) - an allocation never opens a date that hasn't happened yet. */
export function todayIST(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const v = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)!.value;
  return `${v("year")}-${v("month")}-${v("day")}`;
}

/** Every allocation made to this faculty member (facultyMembers doc id). */
export async function loadFacultyAllocations(db: Firestore, collegeId: string, facultyMemberId: string): Promise<LabAttendanceAllocation[]> {
  const snap = await db.collection("colleges").doc(collegeId).collection(COLLECTION)
    .where("facultyId", "==", facultyMemberId).get();
  return snap.docs.map((d) => ({ ...(d.data() as LabAttendanceAllocation), id: d.id }));
}

/**
 * The allocated lab periods this faculty member has on `date`: the published
 * timetable's slots of each allocated assignment on that weekday, for an
 * allocation whose ranges cover the date. Empty for a future date.
 */
export async function getAllocatedPeriodsForDate(
  db: Firestore,
  collegeId: string,
  facultyMemberId: string,
  allocations: LabAttendanceAllocation[],
  date: string,
): Promise<FacultyPeriodOnDate[]> {
  if (date > todayIST()) return [];
  const active = new Set(allocations.filter((a) => dateInRanges(date, a.ranges)).map((a) => a.assignmentId));
  if (active.size === 0) return [];
  const periods = await getFacultyPeriodsForDate(db, collegeId, facultyMemberId, date);
  return periods.filter((p) => active.has(p.slot.assignmentId));
}

export type AllocatedAccess =
  | { ok: true; slot: FacultyPeriodOnDate["slot"]; startTime: string; endTime: string }
  | { ok: false };

/**
 * Write gate for an allocated session: this faculty member holds an allocation
 * for the assignment covering `date`, and the timetable has the assignment's
 * period (`expectedPeriodNumber`, else the first one) on that weekday.
 */
export async function checkAllocatedAccess(
  db: Firestore,
  collegeId: string,
  facultyMemberId: string,
  assignmentId: string,
  date: string,
  expectedPeriodNumber?: number,
): Promise<AllocatedAccess> {
  const snap = await db.collection("colleges").doc(collegeId).collection(COLLECTION).doc(assignmentId).get();
  if (!snap.exists) return { ok: false };
  const allocation = { ...(snap.data() as LabAttendanceAllocation), id: snap.id };
  if (allocation.facultyId !== facultyMemberId) return { ok: false };
  const periods = await getAllocatedPeriodsForDate(db, collegeId, facultyMemberId, [allocation], date);
  const match = expectedPeriodNumber != null
    ? periods.find((p) => p.slot.periodNumber === expectedPeriodNumber)
    : periods[0];
  return match ? { ok: true, slot: match.slot, startTime: match.startTime, endTime: match.endTime } : { ok: false };
}
