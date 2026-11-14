"use client";

// Mark Attendance with no internet: whenever the page loads WITH internet, today's periods - each with its student
// list (`roster`, from today-periods?withRosters=1) - are kept on this device. When the connection is gone later,
// the page shows the saved day, a period can be opened from it and marked, and Submit goes to the offline queue
// (offlineSubmitQueue.ts), which sends it when the connection is back. Today only, one login per device: a saved
// day for another date or another login is ignored.

const KEY = "attendance_offline_day_v1";

export interface SavedDay<P> { uid: string; date: string; savedAt: string; periods: P[] }

export function saveDay<P>(uid: string, date: string, periods: P[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ uid, date, savedAt: new Date().toISOString(), periods } satisfies SavedDay<P>));
  } catch {
    // Storage full or blocked (private browsing): offline marking just isn't available on this device.
  }
}

export function loadDay<P>(uid: string, date: string): SavedDay<P> | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SavedDay<P>;
    return d && d.uid === uid && d.date === date && Array.isArray(d.periods) ? d : null;
  } catch {
    return null;
  }
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
