// Inclusive calendar-day count between two dates (half-day requests are
// always a single day, counted as 0.5 by the caller).
export function countLeaveDays(from: Date, to: Date, isHalfDay?: boolean): number {
  if (isHalfDay) return 0.5;
  const msPerDay = 24 * 60 * 60 * 1000;
  const fromUTC = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toUTC = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.max(1, Math.round((toUTC - fromUTC) / msPerDay) + 1);
}

// Today as a local YYYY-MM-DD string - matches what a <input type="date">
// shows and what the API compares fromDate/toDate against, so leave can't be
// backdated.
export function todayISODate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Full completed years between two dates (used to gate new-joining conversion).
export function yearsOfService(dateOfJoining: Date, asOf: Date): number {
  let years = asOf.getFullYear() - dateOfJoining.getFullYear();
  const anniversaryPassed =
    asOf.getMonth() > dateOfJoining.getMonth() ||
    (asOf.getMonth() === dateOfJoining.getMonth() && asOf.getDate() >= dateOfJoining.getDate());
  if (!anniversaryPassed) years -= 1;
  return Math.max(0, years);
}
