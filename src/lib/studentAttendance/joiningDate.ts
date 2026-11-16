// A student's attendance counts only from their Date of Joining (DOJ): a late joiner is not counted for classes held
// before they arrived - neither "classes conducted" nor "attended". Used by every report, the student's own view,
// mentoring, the timetable denominator, and when attendance is collected (a period's list, office correction, bulk
// import leave out a student on dates before their DOJ).
//
// DOJ only - the roster's "Date of Joining" (YYYY-MM-DD), entered by the College Office / HOD. "Date of Admission" is
// NOT used: it was often entered late or wrong and cut off real attendance, which is why this rule was once switched
// off. A student without a DOJ is counted on every day, as before.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function effectiveJoiningDate(student: { dateOfJoining?: unknown } | null | undefined): string | undefined {
  const v = student?.dateOfJoining;
  return typeof v === "string" && ISO_DATE.test(v.trim()) ? v.trim() : undefined;
}

/** Whether a class held on `sessionDate` ("YYYY-MM-DD") counts for a student who joined on `joinedOn` (on/after DOJ). */
export function countsFromJoining(sessionDate: string | undefined, joinedOn: string | undefined): boolean {
  if (!joinedOn || !sessionDate) return true;
  return sessionDate >= joinedOn;
}

/** Whether a student is on a class's list for `date`: not when their DOJ is later than that date. */
export const joinedBy = (student: { dateOfJoining?: unknown } | null | undefined, date: string): boolean =>
  countsFromJoining(date, effectiveJoiningDate(student));
