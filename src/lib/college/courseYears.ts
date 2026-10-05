// Course-length helpers: the ordinal years / semesters of a course come from the COURSE'S OWN data
// (Course.durationYears, and its courseYearTimings' semesters), never from a fixed "4 years" or
// "2 semesters a year". Pure and isomorphic - used by API routes and client pages alike.

/**
 * The longest course a college can configure. This is the Course Catalog's own validation bound
 * (course-catalog route: "durationYears must be between 1 and 10"), used ONLY as a safety ceiling
 * where a course's real duration is not known - never as a default length.
 */
export const MAX_COURSE_DURATION_YEARS = 10;

/**
 * Semesters in a year when a course has no semester data of its own yet (no timings configured).
 * A last-resort fallback for LABELS/OPTIONS only - the moment a course has courseYearTimings
 * with semesters, those win (see semesterPlan). Kept in one place so it is never re-typed as `* 2`.
 */
export const FALLBACK_SEMESTERS_PER_YEAR = 2;

/** [1..durationYears] for a real duration, [] for a missing/invalid one (never a guessed length). */
export function courseYearNumbers(durationYears: number | null | undefined): number[] {
  const n = Number(durationYears);
  if (!Number.isInteger(n) || n < 1) return [];
  return Array.from({ length: n }, (_, i) => i + 1);
}

export interface TimingSemesters {
  year: number;
  semesters?: { semester: number }[];
}

export interface SemesterPlan {
  /** Every semester number of the course, ascending. */
  semesters: number[];
  /** The ordinal year a semester number belongs to, or undefined if it is not part of the course. */
  yearOf: (semester: number) => number | undefined;
  /** Where the answer came from - "timings" is the course's own data, "fallback" the labelled default. */
  source: "timings" | "fallback";
}

/**
 * The course's semesters and which year each belongs to.
 *
 * From the course's own courseYearTimings when they define semesters AND number them uniquely across
 * the course (1..8 over four years). A course whose timings number semesters per year (1,2 in every
 * year) can't be turned into one flat list, and a course with no semester timings has nothing to read -
 * both use the labelled fallback (`durationYears * FALLBACK_SEMESTERS_PER_YEAR`, `ceil(sem / per-year)`),
 * exactly what the pages used to hard-code.
 */
export function semesterPlan(durationYears: number | null | undefined, timings: TimingSemesters[] = []): SemesterPlan {
  const bySemester = new Map<number, number>();
  let ambiguous = false;
  for (const t of timings) {
    for (const s of t.semesters ?? []) {
      const prev = bySemester.get(s.semester);
      if (prev !== undefined && prev !== t.year) ambiguous = true;
      bySemester.set(s.semester, t.year);
    }
  }
  if (bySemester.size > 0 && !ambiguous) {
    const semesters = Array.from(bySemester.keys()).sort((a, b) => a - b);
    return { semesters, yearOf: (sem) => bySemester.get(sem), source: "timings" };
  }
  const years = courseYearNumbers(durationYears).length;
  const total = years * FALLBACK_SEMESTERS_PER_YEAR;
  return {
    semesters: Array.from({ length: total }, (_, i) => i + 1),
    yearOf: (sem) => (Number.isInteger(sem) && sem >= 1 && sem <= total ? Math.ceil(sem / FALLBACK_SEMESTERS_PER_YEAR) : undefined),
    source: "fallback",
  };
}

/**
 * The years to offer in a college-wide Year picker: the college's configured academic years, capped at the
 * longest course it actually runs. When none of the configured years survives the cap (or none is configured),
 * the years of the longest course itself - never an invented 1..4. No courses at all means no years.
 */
export function selectableYears(configured: number[], courses: { durationYears?: number | null }[]): number[] {
  const longest = courses.reduce((max, c) => Math.max(max, Number(c.durationYears) || 0), 0);
  const capped = longest > 0 ? configured.filter((y) => y <= longest) : configured;
  return capped.length > 0 ? capped : courseYearNumbers(longest);
}

/**
 * The default number of a year's FIRST semester: one past the highest semester already configured for the
 * course's earlier years (so a course whose Year 1 has 3 semesters starts Year 2 at S4). When earlier years
 * have none configured yet, the labelled fallback (FALLBACK_SEMESTERS_PER_YEAR per earlier year).
 */
export function firstSemesterOfYear(year: number, timings: TimingSemesters[] = []): number {
  let highestBefore = 0;
  for (const t of timings) {
    if (!(Number(t.year) < year)) continue;
    for (const s of t.semesters ?? []) highestBefore = Math.max(highestBefore, Number(s.semester) || 0);
  }
  return highestBefore > 0 ? highestBefore + 1 : Math.max(0, year - 1) * FALLBACK_SEMESTERS_PER_YEAR + 1;
}

/**
 * The semester numbers of one year. From the plan when it knows that year; otherwise the labelled fallback
 * (FALLBACK_SEMESTERS_PER_YEAR per year) so a page whose course data didn't load still offers something sensible.
 */
export function semestersInYear(plan: SemesterPlan, year: number): number[] {
  const known = plan.semesters.filter((s) => plan.yearOf(s) === year);
  if (known.length > 0) return known;
  return Array.from({ length: FALLBACK_SEMESTERS_PER_YEAR }, (_, i) => (year - 1) * FALLBACK_SEMESTERS_PER_YEAR + i + 1);
}

/** The year a semester belongs to - the plan's answer, else the labelled fallback arithmetic. */
export function yearOfSemester(plan: SemesterPlan, semester: number): number {
  return plan.yearOf(semester) ?? Math.ceil(semester / FALLBACK_SEMESTERS_PER_YEAR);
}

/** "<year>-<semester within that year>", e.g. "2-1" - positions come from the plan, not from "two per year". */
export function semesterLabel(plan: SemesterPlan, semester: number): string {
  if (!Number.isFinite(semester) || semester < 1) return "";
  const year = yearOfSemester(plan, semester);
  const siblings = semestersInYear(plan, year);
  const index = siblings.indexOf(semester);
  return `${year}-${index >= 0 ? index + 1 : semester - (year - 1) * FALLBACK_SEMESTERS_PER_YEAR}`;
}

/** "1st Year", "2nd Year", "3rd Year", "4th Year", ... - for messages. */
export function ordinalYearLabel(year: number | string): string {
  const n = Number(year);
  if (!Number.isInteger(n) || n < 1) return `Year ${year}`;
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix} Year`;
}
