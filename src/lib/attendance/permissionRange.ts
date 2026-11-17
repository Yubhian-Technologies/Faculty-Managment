// Check-in permission for a date range (HOD > Attendance > Permission): one permission per working day in the
// range, so check-in, the "Permitted HH:MM" badge and the late rules read it exactly as a single-day one.

/** Longest range one grant may cover (days, inclusive). */
export const MAX_PERMISSION_DAYS = 62;

/** "YYYY-MM-DD" dates from `from` to `to` inclusive, Sundays left out. Null when the range is invalid or too long. */
export function permissionDates(from: string, to: string): string[] | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to) || to < from) return null;
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  let span = 0;
  while (d <= end) {
    if (++span > MAX_PERMISSION_DAYS) return null;
    if (d.getUTCDay() !== 0) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
