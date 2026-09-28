import type { Firestore } from "firebase-admin/firestore";
import type { Course, CourseYearTiming, Department } from "@/types";
import { inheritedTimingCourseId } from "@/lib/timetable/sharedYearTiming";

function toJsDate(v: unknown): Date | null {
  const ts = v as { toDate?: () => Date } | undefined;
  return ts?.toDate ? ts.toDate() : v instanceof Date ? v : null;
}

function withinRange(date: Date, start: Date, end: Date): boolean {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return d >= s && d <= e;
}

// Which of a course-year's semesters `date` falls within, per its own
// `semesters` list (see CourseYearTiming - Office/Principal decides how many
// a given year has, not a fixed 2). Null when none are configured at all
// (the course-year has no semester concept - every timetable/draft call
// below then falls back to its pre-semester, single-timetable behavior), or
// `date` falls in the gap between two configured ranges (e.g. a vacation
// break not itself assigned to either).
export function resolveCurrentSemester(
  timing: Pick<CourseYearTiming, "semesters"> | null | undefined,
  date: Date = new Date()
): number | null {
  const semesters = timing?.semesters ?? [];
  for (const s of semesters) {
    const start = toJsDate(s.startDate);
    const end = toJsDate(s.endDate);
    if (start && end && withinRange(date, start, end)) return s.semester;
  }
  return null;
}

// Shared rule for every timetable/draft read or write that needs to decide
// whether an item (a TimetableSlot, a TimetableDraft, ...) belongs to the
// resolved "current" semester:
//   - currentSemester === null (course-year has no semesters configured, or
//     none matches today) - everything matches. This is what keeps a
//     college that's never touched semesters, or a section not yet
//     re-published under the new regime, working exactly as before this
//     feature existed - nothing to filter against.
//   - itemSemester == null (written before this feature existed, or by a
//     course-year that's never had semesters configured) - always matches,
//     never silently hidden by turning semesters on elsewhere.
//   - Otherwise, match only when they're equal - a PRIOR semester's
//     published slots stay in Firestore as history (see publish/route.ts)
//     but drop out of every live view once the next semester starts.
export function matchesCurrentSemester(itemSemester: number | null | undefined, currentSemester: number | null): boolean {
  if (currentSemester === null) return true;
  if (itemSemester === null || itemSemester === undefined) return true;
  return itemSemester === currentSemester;
}

export function filterByCurrentSemester<T extends { semester?: number | null }>(
  items: T[],
  currentSemester: number | null
): T[] {
  return items.filter((i) => matchesCurrentSemester(i.semester, currentSemester));
}

// Either a real configured semester, or a specific Year that has no semester
// concept at all - used by the Student Timetable cascade (Course ->
// Department -> Semester -> Section, see class-leader/timetable page and
// route) to let a Year with an empty `semesters` list still be picked,
// instead of disappearing from an otherwise-mandatory Semester step.
export type SemesterChoice = { kind: "semester"; value: number } | { kind: "fullYear"; year: number };

// Every Semester-step option for a set of candidate Years (typically every
// Year a Course+Department combination actually has a Section for - see
// candidateYears in the Timetable page) - one entry per distinct configured
// semester number across all of them, plus one "Full Year" entry per Year
// that has none configured at all, so it's never silently unreachable.
export function computeSemesterOptions(
  years: number[],
  timingByYear: Map<number, Pick<CourseYearTiming, "year" | "semesters"> | undefined>
): SemesterChoice[] {
  const semesterNumbers = new Set<number>();
  const fullYearYears: number[] = [];
  for (const year of years) {
    const semesters = timingByYear.get(year)?.semesters;
    if (semesters?.length) {
      for (const s of semesters) semesterNumbers.add(s.semester);
    } else {
      fullYearYears.push(year);
    }
  }
  return [
    ...Array.from(semesterNumbers).sort((a, b) => a - b).map((value): SemesterChoice => ({ kind: "semester", value })),
    ...fullYearYears.map((year): SemesterChoice => ({ kind: "fullYear", year })),
  ];
}

// Which Year(s) a picked SemesterChoice resolves to. A "Full Year" choice is
// always exactly the one Year it was offered for. A real semester number can
// resolve to MORE than one Year when two different Years both configure that
// same semester number (e.g. a shared Semester 5 marking the point two
// specializations diverge) - every matching Year is returned, unioned by the
// caller into one combined Section list, rather than picking one arbitrarily.
export function resolveYearsForSemesterChoice(
  years: number[],
  timingByYear: Map<number, Pick<CourseYearTiming, "year" | "semesters"> | undefined>,
  choice: SemesterChoice
): number[] {
  if (choice.kind === "fullYear") return [choice.year];
  return years.filter((year) => timingByYear.get(year)?.semesters?.some((s) => s.semester === choice.value));
}

// Shared doc-id convention for colleges/{id}/timetableDrafts - == sectionId
// when the course-year has no semesters configured (or never did, the still
// very common case), `${sectionId}_sem${semester}` once it does, so building
// Semester 2 never clobbers Semester 1's own in-progress draft. Used by both
// timetable/draft/route.ts and timetable/publish/route.ts.
export function draftDocId(sectionId: string, semester: number | null): string {
  return semester == null ? sectionId : `${sectionId}_sem${semester}`;
}

// A section/assignment routed through the managed-branch flow (e.g.
// "BSM-CSE-A", owned by Computer Science but reached because Basic Science
// Maths manages it for the shared first year) stores the BRANCH's own
// courseId - while the shared year's CourseYearTiming is configured once, on
// the managing department (Basic Science Maths), never on the branch itself.
// An exact (courseId, year) lookup then finds no doc at all even though the
// year is configured exactly where it belongs - see inheritedTimingCourseId's
// own doc-comment, and loadTimetableContext (lib/timetable/loadContext.ts),
// which already applies this same fallback for the Timetable editor. Mirrored
// here so every OTHER caller of this file's resolution functions (Teaching
// Assignments, Class Work Records, Student Attendance History) agrees with
// the Timetable editor about which CourseYearTiming doc actually governs a
// shared-year branch instead of reporting it as unconfigured.
async function loadEffectiveTiming(
  db: Firestore,
  collegeId: string,
  courseId: string,
  year: number
): Promise<CourseYearTiming | null> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const directSnap = await collegeRef.collection("courseYearTimings").doc(`${courseId}_year${year}`).get();
  if (directSnap.exists) return directSnap.data() as CourseYearTiming;

  const courseSnap = await collegeRef.collection("courses").doc(courseId).get();
  if (!courseSnap.exists) return null;
  const ownCourse = { id: courseSnap.id, ...(courseSnap.data() as object) } as Course;

  const [coursesSnap, deptsSnap] = await Promise.all([
    collegeRef.collection("courses").get(),
    collegeRef.collection("departments").get(),
  ]);
  const courses = coursesSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Course[];
  const departments = deptsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as (Department & { id: string })[];

  const inheritedId = inheritedTimingCourseId(ownCourse, year, departments, courses);
  if (!inheritedId) return null;
  const inheritedSnap = await collegeRef.collection("courseYearTimings").doc(`${inheritedId}_year${year}`).get();
  return inheritedSnap.exists ? (inheritedSnap.data() as CourseYearTiming) : null;
}

// One-off, single-course-year resolution for routes that don't already have
// loadTimetableContext's full TimetableContext loaded (a plain draft
// GET/PATCH, or a read-only timetable view) - fetches just that one
// CourseYearTiming doc rather than the whole collection (falling back to the
// shared-year manager's, see loadEffectiveTiming). Null when no timing exists
// anywhere for this course-year (same as no semesters configured).
export async function resolveSectionCurrentSemester(
  db: Firestore,
  collegeId: string,
  courseId: string,
  year: number,
  now: Date = new Date()
): Promise<number | null> {
  const timing = await loadEffectiveTiming(db, collegeId, courseId, year);
  if (!timing) return null;
  return resolveCurrentSemester(timing, now);
}

// Shared resolution for any route that lets its caller deliberately pick a
// semester instead of always acting on whatever's live today - Teaching
// Assignments' semester picker (stamping a new assignment, filtering the
// list), the Timetable editor's semester picker (which draft/published slots
// to read or write), and Timetable History (browsing a semester other than
// the current one). Every one of these agrees on the same validation here
// rather than each re-deriving it slightly differently: a requested semester
// must be one this course-year's CourseYearTiming.semesters actually lists -
// never a client-supplied number silently accepted deep inside a write.
// Omitting `requested` falls back to resolveCurrentSemester exactly as
// before this override existed (today's date against the configured
// ranges), so every caller that hasn't been updated to offer a picker keeps
// working unchanged.
export async function resolveRequestedSemester(
  db: Firestore,
  collegeId: string,
  courseId: string,
  year: number,
  requested: number | null | undefined,
  now: Date = new Date()
): Promise<{ ok: true; semester: number | null } | { ok: false; error: string }> {
  const timing = await loadEffectiveTiming(db, collegeId, courseId, year);

  if (requested == null) {
    return { ok: true, semester: resolveCurrentSemester(timing, now) };
  }
  const configured = (timing?.semesters ?? []).map((s) => s.semester);
  if (!configured.includes(requested)) {
    return { ok: false, error: "That semester isn't configured for this course-year" };
  }
  return { ok: true, semester: requested };
}
