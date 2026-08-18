// A hardcoded weekly rule (getDay() === 0), independent of the office-managed
// Holidays calendar (colleges/{id}/holidays) - that calendar plus approved
// leave still aren't cross-referenced here yet (deliberately deferred, see
// the NOT_REGISTERED/NOT_MARKED split in the attendance report routes).
export const SUNDAY_HOLIDAY_MESSAGE = "Today is Sunday — a holiday. No attendance required.";

export function isSunday(now: Date = new Date()): boolean {
  return now.getDay() === 0;
}

// HOD/Principal/VP can only correct attendance (POST /api/college/attendance/
// manual) for the CURRENT month, and only through the 25th - a payroll-style
// cutoff. Once today passes the 25th, the whole month locks (all its days,
// not just the ones after the 25th) and becomes view-only; so does every
// prior month, always. The already-enforced "no future dates" rule means any
// reachable day in the current month is automatically <= 25 once today
// itself is <= 25, so no separate per-day-of-month check is needed on top.
export const MANUAL_EDIT_WINDOW_CLOSED_MESSAGE =
  "Attendance can only be corrected for the current month, up to the 25th. This month is now view-only.";

export function isManualEditWindowOpen(recordDate: Date, now: Date = new Date()): boolean {
  return (
    recordDate.getFullYear() === now.getFullYear() &&
    recordDate.getMonth() === now.getMonth() &&
    now.getDate() <= 25
  );
}
