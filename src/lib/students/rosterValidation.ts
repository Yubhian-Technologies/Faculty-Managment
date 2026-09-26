// Lightweight, pure (no Firestore/network) roster-field validators shared by
// the bulk importer (import-excel/route.ts) and, where the field is
// free-text there too, the single Add Student endpoint (students/route.ts).
// Every function here is a plain string/number check - fast, deterministic,
// row-local - deliberately NOT a database lookup or external API call, so
// running one per row of a 500-row import stays cheap. Each returns a
// human-readable error string when the value is invalid, or null when it's
// fine (including "not supplied" - none of these make an optional field
// mandatory; that's decided by the caller before ever reaching these).

/**
 * A student's Academic Year must fall within the course's own configured
 * duration (Course.durationYears, e.g. 4 for a B.Tech, 2 for an M.Tech) -
 * the same ceiling the manual Add/Edit form's own Year dropdown already
 * enforces client-side (yearOptionsForCourse, RosterFieldInputs.tsx), now
 * backed up here so the bulk importer can't silently accept a Year 5
 * B.Tech row the manual form would never have offered. Deliberately generic
 * (reads whatever durationYears the course was actually configured with,
 * never a hardcoded "BTECH=4/MTECH=2" table) - this college's own course
 * catalog is the single source of truth for how many years each programme
 * runs. A course with no durationYears configured at all is left
 * unrestricted (nothing to validate against), matching every other
 * "don't reject on missing configuration" rule in this app.
 */
export function validateYearForCourseDuration(
  year: number,
  durationYears: number | undefined,
  courseLabel: string
): string | null {
  if (!durationYears || durationYears <= 0) return null;
  if (!Number.isInteger(year) || year < 1 || year > durationYears) {
    return `Academic Year must be between 1 and ${durationYears} for ${courseLabel} (this course runs ${durationYears} year${durationYears === 1 ? "" : "s"}).`;
  }
  return null;
}
