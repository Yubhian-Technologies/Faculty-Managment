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

// Today's date in the college's own calendar (India, Asia/Kolkata) as a
// YYYY-MM-DD string - matches what a <input type="date"> shows and what the
// API compares fromDate/toDate against, so leave can't be backdated.
// Deliberately NOT `new Date().getFullYear()/getMonth()/getDate()` - those
// read "now" through the CALLER's own local timezone, which for a
// server-side call means whatever timezone the deployment host happens to
// run in (commonly UTC), not India's. UTC sits behind IST by 5:30h, so for
// the first ~5.5 hours of every India calendar day, a UTC-local read of
// "now" still reports the PREVIOUS day - e.g. a substitute picked for
// today's approved leave would silently fail to show up on the timetable
// (see getActiveSubstitutionsForDates and currentWeekDateKeys in
// periodCoverage.ts, which key off this same "what day is it" concept)
// because the server's idea of "today"
// disagreed with India's. Explicitly anchoring to Asia/Kolkata makes this
// correct regardless of the host's own timezone - and is also correct for a
// browser call (LeaveApplyForm.tsx): the college's calendar day is what
// matters here, not wherever the viewer's device happens to be set.
export function todayISODate(): string {
  // formatToParts, not the locale's default punctuation - "en-CA" reliably
  // orders year/month/day but isn't a spec-guaranteed hyphen separator.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
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
