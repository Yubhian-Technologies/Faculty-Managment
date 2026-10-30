// A student's attendance is counted only from the day they joined classes, so a
// late joiner is not marked absent for days before they arrived (typically their
// first semester). The date is the roster's "Date of Joining", falling back to
// "Date of Admission"; a student with neither is not cut off at all, which is the
// behaviour every student had before the field existed.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function effectiveJoiningDate(
  student: { dateOfJoining?: unknown; dateOfAdmission?: unknown } | null | undefined
): string | undefined {
  for (const v of [student?.dateOfJoining, student?.dateOfAdmission]) {
    if (typeof v === "string" && ISO_DATE.test(v.trim())) return v.trim();
  }
  return undefined;
}

/**
 * Whether a session held on `sessionDate` ("YYYY-MM-DD") counts for a student who joined on `joinedOn`.
 *
 * Always true: a student's attendance counts on every day the register has it, including days before their recorded
 * joining or admission date (those dates are often entered late, so they are not trusted to cut attendance off). The
 * function and its callers are kept so the rule can be switched back in one place.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for the callers' signature, see above
export function countsFromJoining(_sessionDate: string | undefined, _joinedOn: string | undefined): boolean {
  return true;
}
