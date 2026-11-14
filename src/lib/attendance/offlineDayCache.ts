"use client";

// Mark Attendance with no internet: whenever the page loads WITH internet, today's periods - each with its student
// list (`roster`, from today-periods?withRosters=1) - are kept on this device (the last few days, by date). When the connection is gone later,
// the page shows the saved day, a period can be opened from it and marked, and Submit goes to the offline queue
// (offlineSubmitQueue.ts), which sends it when the connection is back. One login per device; a day not saved
// falls back to the latest saved copy of the same weekday.

const KEY = "attendance_offline_days_v2";
const KEEP_DAYS = 8;

// What a saved period needs for the weekday fallback: its ids, and the attendance of the day it was saved (dropped).
interface DayPeriod { assignmentId: string; periodNumber: number; sessionId: string; session?: unknown; sessionStatus?: string | null }

export interface SavedDay<P> {
  uid: string;
  date: string;
  savedAt: string;
  periods: P[];
  /** Set when today was never saved: the earlier date (same weekday) these classes come from. */
  fromDate?: string;
}

interface Store<P> { uid: string; days: Record<string, { savedAt: string; periods: P[] }> }

function read<P>(): Store<P> | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store<P>) : null;
  } catch {
    return null;
  }
}

export function saveDay<P>(uid: string, date: string, periods: P[]): void {
  try {
    const cur = read<P>();
    const days = cur && cur.uid === uid ? { ...cur.days } : {};
    days[date] = { savedAt: new Date().toISOString(), periods };
    // Keep the latest few days only (one per weekday is enough for the fallback).
    const keep = Object.keys(days).sort().slice(-KEEP_DAYS);
    const trimmed = Object.fromEntries(keep.map((d) => [d, days[d]]));
    localStorage.setItem(KEY, JSON.stringify({ uid, days: trimmed } satisfies Store<P>));
  } catch {
    // Storage full or blocked (private browsing): offline marking just isn't available on this device.
  }
}

const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/**
 * Today's saved classes - or, when Mark Attendance wasn't opened with internet today, the latest saved day on the
 * same weekday (the timetable repeats weekly). In that case the earlier day's attendance is dropped and each period
 * is re-keyed to today; the server still checks everything when it syncs (today's timetable, holidays, students).
 */
export function loadDay<P extends DayPeriod>(uid: string, date: string): SavedDay<P> | null {
  const store = read<P>();
  if (!store || store.uid !== uid) return null;
  const exact = store.days[date];
  if (exact) return { uid, date, savedAt: exact.savedAt, periods: exact.periods };
  const sameWeekday = Object.keys(store.days).filter((d) => d < date && weekdayOf(d) === weekdayOf(date)).sort().pop();
  if (!sameWeekday) return null;
  const old = store.days[sameWeekday];
  const periods = old.periods.map((p) => ({
    ...p, session: null, sessionStatus: null, sessionId: `${p.assignmentId}_${date}_${p.periodNumber}`,
  }));
  return { uid, date, savedAt: old.savedAt, periods, fromDate: sameWeekday };
}

/** Today's date in IST (YYYY-MM-DD) - the college's day, whatever the phone's time zone. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Minutes since midnight IST, for opening a saved period by the phone's clock. */
export function istMinutesNow(now: Date = new Date()): number {
  const t = new Date(now.getTime() + 330 * 60_000);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}
