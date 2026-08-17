// Calendar-day key ("Y-M-D", month 0-based) for comparing two Dates by
// local day regardless of their time-of-day component - used to match a
// leave-range day against a holiday's date.
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Inclusive day count between two dates, excluding every Sunday and every
// date in `holidayDates` (a set of dateKey()s - see holidaysCount.ts's
// getHolidayDateKeys) - neither was ever a working day to begin with, so a
// leave request spanning one doesn't draw down balance for it. Half-day
// requests are always a single day, counted as 0.5 regardless.
// Shared by the server (applications/route.ts POST, the authoritative count
// that gets stored and deducted) and the client-side preview
// (LeaveApplyForm.tsx), so both agree on the same number before and after
// submission.
export function countWorkingDays(from: Date, to: Date, holidayDates: Set<string>, isHalfDay?: boolean): number {
  if (isHalfDay) return 0.5;
  let count = 0;
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor <= end) {
    if (cursor.getDay() !== 0 && !holidayDates.has(dateKey(cursor))) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
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

// Every calendar date between `from` and `to` (inclusive) that counts as a
// working day - same rule countWorkingDays uses (no Sundays, no declared
// holidays) - but returning the actual Date objects instead of just a count.
// Used by the period-coverage feature (lib/leave/periodCoverage.ts) to know
// which real dates within a leave range need a TimetableSlot lookup.
export function enumerateWorkingDates(from: Date, to: Date, holidayDates: Set<string>): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor <= end) {
    if (cursor.getDay() !== 0 && !holidayDates.has(dateKey(cursor))) dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

// "YYYY-MM-DD" for a Date, local calendar day - the form period-coverage
// entries key their date by (distinct from dateKey()'s "Y-M-D" used only for
// holiday-set membership checks).
export function isoDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
