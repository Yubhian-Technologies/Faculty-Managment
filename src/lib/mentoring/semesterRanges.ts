import type { SemesterRange, YearTiming } from "@/lib/studentAttendance/studentReportRange";

// The semesters the Student Mentoring Record has a page for.
//
// A course-year's timing holds the dates of the CURRENT academic year only (course-year-timings
// requires them inside it). For a student in year 2, Year 1's "Semester 2" is therefore dated in the
// future on that calendar even though they finished it long ago - so the student attendance rule
// "offer a semester once its start date has passed" would hide every earlier year's second semester.
//
//  - years BEFORE the student's own year: every semester is theirs and already over, whatever its dates
//    (withEarlierYears also adds the ones a timing does not list);
//  - the student's OWN year: only the semesters that have started (a future one is not offered).
// On a collision of semester numbers the later year wins, the same rule as semesterOptionsForStudent,
// which the student's own Attendance page still uses.
//
// Semester numbers are global (Year 1 = 1-2, Year 2 = 3-4, ...): a course's years hold as many as its
// busiest timing lists, and two when no timing says more (the college default).
const perYearOf = (timings: YearTiming[]): number => Math.max(2, ...timings.map((t) => t.semesters.length));
const yearNumbers = (year: number, perYear: number): number[] => Array.from({ length: perYear }, (_, i) => (year - 1) * perYear + 1 + i);
const undated = (semester: number) => ({ semester, startDate: "", endDate: "" });

/**
 * Every year a student has finished has ALL its semesters on the record. A timing often lists only
 * the semester running now (or no longer exists at all - timings hold the current academic year
 * only), so the semesters it does not list are added undated. Undated semesters carry no attendance
 * window; their subjects come from the kept copy, the results or the curriculum. Semesters a timing
 * does list keep their dates, and the student's own year is left as it is (see mentoringSemesterRanges).
 */
export function withEarlierYears(timings: YearTiming[], studentYear: number): YearTiming[] {
  const perYear = perYearOf(timings);
  const out: YearTiming[] = [];
  for (let year = 1; year < studentYear; year++) {
    const own = timings.find((t) => t.year === year)?.semesters ?? [];
    const have = new Set(own.map((s) => s.semester));
    const missing = yearNumbers(year, perYear).filter((n) => !have.has(n)).map(undated);
    out.push({ year, semesters: [...own, ...missing].sort((a, b) => a.semester - b.semester) });
  }
  return [...out, ...timings.filter((t) => t.year >= studentYear)];
}

export function mentoringSemesterRanges(timings: YearTiming[], studentYear: number, today: string): SemesterRange[] {
  const perYear = perYearOf(timings);
  const byNumber = new Map<number, SemesterRange>();
  for (const t of timings) {
    if (t.year < 1 || t.year > studentYear) continue;
    let ordered = [...t.semesters].sort((a, b) => a.semester - b.semester);
    if (t.year === studentYear) {
      // Only semesters that have started - and, when the timing lists just the running one, the
      // earlier semesters of this year too (they are over).
      ordered = ordered.filter((s) => s.startDate <= today);
      const top = ordered.length > 0 ? ordered[ordered.length - 1].semester : 0;
      const have = new Set(ordered.map((s) => s.semester));
      ordered = [...ordered, ...yearNumbers(t.year, perYear).filter((n) => n < top && !have.has(n)).map(undated)].sort((a, b) => a.semester - b.semester);
    }
    ordered.forEach((s, i) => byNumber.set(s.semester, { ...s, year: t.year, inYear: i + 1 }));
  }
  return Array.from(byNumber.values()).sort((a, b) => a.semester - b.semester);
}

/**
 * The semester running now: within the student's latest year, the one `today` falls in, else the
 * latest that has started (between two semesters), else the last one. Earlier years never count as
 * "running" even when their (current-calendar) dates contain today.
 */
export function currentMentoringSemester(ranges: SemesterRange[], today: string): SemesterRange | null {
  if (ranges.length === 0) return null;
  const latestYear = Math.max(...ranges.map((r) => r.year ?? 0));
  const own = ranges.filter((r) => (r.year ?? 0) === latestYear);
  const within = own.filter((r) => r.startDate <= today && today <= r.endDate).pop();
  if (within) return within;
  const started = own.filter((r) => r.startDate <= today).pop();
  return started ?? own[own.length - 1] ?? ranges[ranges.length - 1];
}
