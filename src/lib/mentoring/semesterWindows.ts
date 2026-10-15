// Small pure helpers for the semester sheet of the Student Mentoring Record:
// which dates "attendance up to Mid I / Mid II / end of semester" cover, the
// academic-year label of a semester, and the booklet's wording for a semester.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The day before a YYYY-MM-DD date (UTC arithmetic, no clock). */
export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface AttendanceWindow { from: string; to: string }

/**
 * The cumulative attendance window "up to" a mid exam: from the semester's start
 * to the day before the mid exam begins. null when there is nothing to count
 * yet - no mid scheduled, the mid has not started, or it begins before (or on)
 * the semester's first day.
 */
export function windowUpToMid(
  semesterStart: string | null,
  semesterEnd: string | null,
  midFromDate: string | null,
  today: string
): AttendanceWindow | null {
  if (!semesterStart || !midFromDate || !DATE_RE.test(midFromDate)) return null;
  if (midFromDate > today) return null;
  let to = dayBefore(midFromDate);
  if (semesterEnd && to > semesterEnd) to = semesterEnd;
  if (to > today) to = today;
  return to < semesterStart ? null : { from: semesterStart, to };
}

/** The whole semester so far: its start to its end, or to today while it is running. */
export function windowEndOfSemester(semesterStart: string | null, semesterEnd: string | null, today: string): AttendanceWindow | null {
  if (!semesterStart || semesterStart > today) return null;
  const to = semesterEnd && semesterEnd < today ? semesterEnd : today;
  return { from: semesterStart, to };
}

/** "2025-26" for a session starting in `startYear` - the label academic sessions are kept under. */
export function academicYearLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** First four-digit year of an admission batch like "2024-2028"; null when absent. */
export function batchStartYearOf(batch: string | null | undefined): number | null {
  const m = /(\d{4})/.exec(batch ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * The academic year a student's Year-N falls in, from their admission batch. A
 * lateral entrant's batch starts in the year they joined Year 2, so Year 2 is the
 * batch's first session. Null when the batch is unknown; callers prefer the
 * academic year printed on the student's own results when there is one.
 */
export function academicYearOfStudentYear(batch: string | null | undefined, studentType: string | undefined, year: number): string | null {
  const start = batchStartYearOf(batch);
  if (start == null || year < 1) return null;
  const firstYear = (studentType ?? "").toLowerCase() === "lateral" ? 2 : 1;
  return academicYearLabel(start + Math.max(0, year - firstYear));
}

const ROMAN: Record<number, string> = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI", 7: "VII", 8: "VIII", 9: "IX", 10: "X" };
export const roman = (n: number): string => ROMAN[n] ?? String(n);

/** "II Year I Semester" - the heading of each semester page of the booklet. */
export function semesterHeading(semester: number, year: number | null, inYear: number | null): string {
  if (year && inYear) return `${roman(year)} Year ${roman(inYear)} Semester`;
  return `Semester ${semester}`;
}

/** Subject codes compare ignoring case and surrounding space. */
export const codeKey = (code: string | undefined | null): string => (code ?? "").trim().toUpperCase();

/** "2026-03-05T..." (ms) -> "03-26", the "mm-yy" of the booklet's supplementary columns. */
export function monthYearLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = new Date(ms + 5.5 * 3600 * 1000); // IST
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCFullYear() % 100).padStart(2, "0")}`;
}
