// Daily self-attendance window (Faculty/HOD/Principal/Vice Principal alike):
// check-in doesn't open until this hour - shared by the check-in API route
// (the actual enforcement) and each "My Attendance" page (so the portal is
// visibly locked before 6 AM instead of just failing after the fact).
export const CHECK_IN_OPENS_HOUR = 6;

export const CHECK_IN_CLOSED_MESSAGE = "The attendance portal will open at 6:00 AM — take attendance after 6:00 AM.";

export function isBeforeCheckInWindow(now: Date = new Date()): boolean {
  return now.getHours() < CHECK_IN_OPENS_HOUR;
}

// A hardcoded weekly rule (getDay() === 0), independent of the office-managed
// Holidays calendar (colleges/{id}/holidays) - that calendar plus approved
// leave still aren't cross-referenced here yet (deliberately deferred, see
// the NOT_REGISTERED/NOT_MARKED split in the attendance report routes).
export const SUNDAY_HOLIDAY_MESSAGE = "Today is Sunday — a holiday. No attendance required.";

export function isSunday(now: Date = new Date()): boolean {
  return now.getDay() === 0;
}
