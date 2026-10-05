import { yearSemesterLabelIn } from "@/lib/academic/format";
import type { CourseYearTiming } from "@/types";

export interface SemesterOption {
  /** The stored semester number - what every API and record is keyed by. */
  semester: number;
  /** The course-year it belongs to. */
  year: number;
  /** "2-1" - the year, and this semester's position within it. */
  label: string;
}

/**
 * A course's semester picker options, built from its own Course-Year Timings.
 *
 * Several pickers used to build this list as `durationYears * 2` and label it
 * "3/8". That is wrong twice over:
 *
 *  - The COUNT is a guess. A course-year has however many semesters
 *    Office/Principal configured on it (CourseYearTiming.semesters), which is
 *    not always two and is not always configured for every year.
 *
 *  - The LABEL cannot be derived from the number, because the number does not
 *    mean the same thing at every college. Both conventions are live: year 2
 *    is stored as semesters [1,2] at most colleges and [3,4] at others. Only
 *    the semester's POSITION within its own year is stable, which is what
 *    yearSemesterLabelIn uses.
 *
 * Years come back in order, and semesters in order within each year. A timing
 * with no semesters configured contributes nothing - that course-year simply
 * has no semester concept yet, and the caller shows its "no semesters" state.
 */
export function semesterOptionsFromTimings(
  timings: Pick<CourseYearTiming, "year" | "semesters">[]
): SemesterOption[] {
  const byYear = [...timings]
    .filter((t) => Number.isFinite(Number(t.year)) && Number(t.year) >= 1)
    .sort((a, b) => Number(a.year) - Number(b.year));

  const out: SemesterOption[] = [];
  for (const timing of byYear) {
    const year = Number(timing.year);
    const numbers = Array.from(
      new Set((timing.semesters ?? []).map((s) => Number(s.semester)).filter((n) => Number.isFinite(n)))
    ).sort((a, b) => a - b);
    for (const semester of numbers) {
      out.push({ semester, year, label: yearSemesterLabelIn(year, numbers, semester) });
    }
  }
  return out;
}

/**
 * The options for one year only - for a picker that already has a Year filter
 * beside it, so the semester list must not span the whole course.
 */
export function semesterOptionsForYear(
  timings: Pick<CourseYearTiming, "year" | "semesters">[],
  year: number | string
): SemesterOption[] {
  return semesterOptionsFromTimings(timings).filter((o) => o.year === Number(year));
}
