// Semester Changeover > class-work end date (one date for a course + year, every department's course-year at once).
// A course-year's semesters are date ranges (CourseYearTiming.semesters, lib/college/semester.ts decides which is
// current). Ending Semester N here = its end date becomes the class-work end, and Semester N+1 gets its start (and
// end). Pure: the route loads the timings, plans each one here and writes them in one batch.

export interface SemesterRange { semester: number; start: string; end: string }

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const valid = (iso: string) => ISO_DATE.test(iso) && !Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime());

/** The same ordering rules the Semester Timings form enforces: unique numbers, start <= end, no overlap in order. */
export function semesterRangesError(ranges: SemesterRange[]): string | null {
  const sorted = [...ranges].sort((a, b) => a.semester - b.semester);
  const seen = new Set<number>();
  for (const s of sorted) {
    if (!Number.isInteger(s.semester) || s.semester < 1) return "Each semester needs a valid number (1, 2, 3 ...).";
    if (seen.has(s.semester)) return `Semester ${s.semester} is listed twice.`;
    seen.add(s.semester);
    if (!valid(s.start) || !valid(s.end)) return `Semester ${s.semester}: enter both a start and an end date.`;
    if (s.end < s.start) return `Semester ${s.semester}: the end date must be on or after the start date.`;
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start <= sorted[i - 1].end) return `Semester ${sorted[i].semester} must start after Semester ${sorted[i - 1].semester} ends.`;
  }
  return null;
}

export interface ChangeoverDates {
  /** The semester whose class work ends (e.g. 5 = III-I). */
  semester: number;
  /** Its last day of class work. */
  classWorkEnd: string;
  /** The next semester's first and last day (Semester N+1). */
  nextStart: string;
  nextEnd: string;
}

/**
 * One course-year's new semester list: Semester N ends on the class-work end date, Semester N+1 is set (added when
 * missing). Other semesters are kept as they are. Returns the problem when the result would not hold together.
 */
export function planChangeover(current: SemesterRange[], c: ChangeoverDates): { ok: true; semesters: SemesterRange[] } | { ok: false; error: string } {
  if (!valid(c.classWorkEnd)) return { ok: false, error: "Enter the class-work end date." };
  if (!valid(c.nextStart) || !valid(c.nextEnd)) return { ok: false, error: `Enter Semester ${c.semester + 1}'s start and end dates.` };
  if (c.nextStart <= c.classWorkEnd) return { ok: false, error: `Semester ${c.semester + 1} must start after the class-work end date.` };
  if (c.nextEnd < c.nextStart) return { ok: false, error: `Semester ${c.semester + 1}'s end date must be on or after its start date.` };
  const own = current.find((s) => s.semester === c.semester);
  if (!own) return { ok: false, error: `Semester ${c.semester} is not set up for this course-year - add it on Semester Timings first.` };
  if (c.classWorkEnd < own.start) return { ok: false, error: `The class-work end date is before Semester ${c.semester} starts (${own.start}).` };
  const semesters = [
    ...current.filter((s) => s.semester !== c.semester && s.semester !== c.semester + 1),
    { semester: c.semester, start: own.start, end: c.classWorkEnd },
    { semester: c.semester + 1, start: c.nextStart, end: c.nextEnd },
  ].sort((a, b) => a.semester - b.semester);
  const err = semesterRangesError(semesters);
  if (err) return { ok: false, error: err };
  return { ok: true, semesters };
}

/** Roman-style class label for a continuous semester number: 5 -> "III-I", 6 -> "III-II" (2 semesters a year). */
export function semesterLabel(semester: number): string {
  const year = Math.ceil(semester / 2);
  const part = semester % 2 === 1 ? "I" : "II";
  return `${["", "I", "II", "III", "IV", "V", "VI"][year] ?? year}-${part}`;
}
