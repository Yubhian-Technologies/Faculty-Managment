import type { CourseYearTiming } from "@/types";
import { matchesCurrentSemester, resolveCurrentSemester } from "@/lib/college/semester";
import { matchesCurrentAcademicYear } from "@/lib/college/academicSession";
import type { TimingLookup } from "@/lib/timetable/facultyOverlap";

// Which slots are "live" - part of the timetable running right now, as opposed
// to history. A slot from a different semester of its OWN course-year, or from
// a different academic session (a past cohort's finished class), is history
// and never a conflict. Each slot is judged against its own course-year's
// current semester: two different courses can be in different semesters at once.
// Legacy slots with no semester / academicYear tag count as live (the
// null-tolerant convention used everywhere else - see matchesCurrentSemester).

export interface SlotIdentity {
  courseId: string;
  year: number;
  semester?: number | null;
  academicYear?: string | null;
}

export function makeLiveSlotPredicate(
  lookup: TimingLookup,
  currentAcademicYear: string,
  opts: { now?: Date; semesterOverrides?: ReadonlyMap<string, number | null> } = {}
): (slot: SlotIdentity) => boolean {
  const now = opts.now ?? new Date();
  const cache = new Map<string, number | null>();
  const currentSemesterOf = (courseId: string, year: number): number | null => {
    const key = `${courseId}_${year}`;
    if (opts.semesterOverrides?.has(key)) return opts.semesterOverrides.get(key) ?? null;
    if (!cache.has(key)) cache.set(key, resolveCurrentSemester(lookup(courseId, year) as CourseYearTiming | null, now));
    return cache.get(key) ?? null;
  };
  return (slot) =>
    matchesCurrentSemester(slot.semester, currentSemesterOf(slot.courseId, slot.year)) &&
    matchesCurrentAcademicYear(slot.academicYear ?? null, currentAcademicYear);
}
