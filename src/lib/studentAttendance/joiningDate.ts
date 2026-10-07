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

/** Whether a session held on `sessionDate` ("YYYY-MM-DD") counts for a student who joined on `joinedOn`. */
export function countsFromJoining(sessionDate: string | undefined, joinedOn: string | undefined): boolean {
  return !joinedOn || !sessionDate || sessionDate >= joinedOn;
}
