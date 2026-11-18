import type { Firestore } from "firebase-admin/firestore";

// Extra time to post student attendance after college hours (per college, set by the College Admin):
// colleges/{c}/settings/attendancePosting { extraMinutes: 0..MAX_EXTRA_MINUTES }. A period is postable from its
// start until the course-year's college end time (or its own end, if later) PLUS these minutes - see
// resolvePeriodWindow in lib/timetable/currentPeriod.ts, the one place that decides it for the Mark Attendance list
// and the write gate alike. On-time / late and the not-posted alerts still measure against the period's own end.

export const MAX_EXTRA_MINUTES = 240;
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Promise<number> }>();

export const attendancePostingRef = (db: Firestore, c: string) =>
  db.collection("colleges").doc(c).collection("settings").doc("attendancePosting");

export function cleanExtraMinutes(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MAX_EXTRA_MINUTES ? n : null;
}

export function invalidatePostingExtra(c?: string): void {
  if (!c) cache.clear(); else cache.delete(c);
}

export function postingExtraMinutes(db: Firestore, c: string): Promise<number> {
  const hit = cache.get(c);
  if (hit && Date.now() - hit.at < TTL_MS && !process.env.FIRESTORE_EMULATOR_HOST) return hit.value;
  // Never in the way of posting: anything unreadable counts as no extra time.
  let value: Promise<number>;
  try {
    value = attendancePostingRef(db, c).get()
      .then((s) => cleanExtraMinutes((s.data() as { extraMinutes?: unknown } | undefined)?.extraMinutes) ?? 0)
      .catch(() => 0);
  } catch {
    value = Promise.resolve(0);
  }
  cache.set(c, { at: Date.now(), value });
  return value;
}

/** "HH:MM" + minutes, never past 23:59. */
export function addMinutesCapped(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = Math.min(h * 60 + m + Math.max(0, minutes), 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
