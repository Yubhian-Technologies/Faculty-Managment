// Attendance marked on the faculty's phone with no internet and sent later by the Mark Attendance offline queue.
// The request carries { offline: { markedAt } } (the phone's time at Submit). The server then accepts it from the
// period's start until the end of that day (checkFacultyPeriodWindow `untilEndOfDay`) instead of the college's
// closing time, and flags the session `markedOffline` so the HOD sees it. Same-day only: the period window
// itself still refuses any other date.

export interface OfflineMark { markedAt: string }

/** The request's `offline` field, or null when absent / not a valid time. A phone time in the future is clamped to now. */
export function parseOfflineMark(raw: unknown, now: Date = new Date()): OfflineMark | null {
  if (!raw || typeof raw !== "object") return null;
  const at = (raw as { markedAt?: unknown }).markedAt;
  if (typeof at !== "string" || at.length > 40) return null;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  return { markedAt: new Date(Math.min(t, now.getTime())).toISOString() };
}

/** What is stored on the session: the phone's time and when the server received it. */
export const offlineStamp = (m: OfflineMark, now: Date = new Date()) => ({ markedAt: m.markedAt, syncedAt: now.toISOString() });
