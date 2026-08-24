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

/**
 * Basic Year <-> Semester sanity check: Year N should only ever pair with
 * Semester (2N-1) or (2N) - Year 1 -> Semester 1/2, Year 2 -> Semester 3/4,
 * and so on. That flat 2-per-year width is only the DEFAULT though -
 * `semesterCountsByYear` (year -> that year's configured semester count,
 * i.e. CourseYearTiming.semesters.length for whichever years have a timing
 * doc) lets a caller override it per year so a course with an irregular
 * semester count (e.g. a trimester Year 1) validates against what's actually
 * configured instead of always assuming 2. Widths are summed cumulatively
 * across years 1..year, matching how StudentRecord.semester has always been
 * stored (course-global, not reset each year) - CourseYearTiming's own
 * semester numbers are year-local (reset to 1..count every year, see
 * CourseYearTimingForm's resizeSemesters) and are never compared directly
 * here, only their COUNT is used as this year's width. Omitting the map
 * entirely reproduces the exact old formula, so no caller is forced to
 * change. Semester is optional everywhere it's read, so this only fires
 * when a row actually supplies one.
 */
export function validateYearSemesterConsistency(
  year: number,
  semester: number | undefined,
  semesterCountsByYear?: Record<number, number>
): string | null {
  if (semester === undefined || !Number.isFinite(semester)) return null;
  let minSem = 1;
  for (let y = 1; y < year; y++) minSem += semesterCountsByYear?.[y] ?? 2;
  const maxSem = minSem + (semesterCountsByYear?.[year] ?? 2) - 1;
  if (semester < minSem || semester > maxSem) {
    return `Year ${year} + Semester ${semester} is inconsistent - Year ${year} must use Semester ${minSem}${maxSem > minSem ? `-${maxSem}` : ""}.`;
  }
  return null;
}
