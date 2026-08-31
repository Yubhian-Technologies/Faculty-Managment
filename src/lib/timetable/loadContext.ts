import type { Firestore } from "firebase-admin/firestore";
import type {
  CourseYearTiming, Section, Subject, TeachingAssignment, TimetableRules, TimetableSlot,
} from "@/types";
import { DEFAULT_TIMETABLE_RULES } from "@/types";
import { resolveCurrentSemester, matchesCurrentSemester } from "@/lib/college/semester";
import { inheritedTimingCourseId } from "@/lib/timetable/sharedYearTiming";
import type { Course, Department } from "@/types";

// Everything the preflight and the solver need for one section, loaded once.
// Kept server-side (takes an admin Firestore) so the solver itself stays pure.

export interface TimetableContext {
  section: Section;
  timing: CourseYearTiming | null;
  rules: TimetableRules;
  assignments: TeachingAssignment[];
  courseYearSubjects: Subject[];
  subjectsById: Map<string, Subject>;
  /** This section's existing pinned/manual slots - the generator works around them. */
  pinnedSlots: TimetableSlot[];
  /** facultyId -> "DAY:period" cells busy in ANY other section. */
  busyFaculty: Map<string, Set<string>>;
  // Resolved once from `timing` - null when this course-year has no
  // semesters configured (see CourseYearTiming.semesters). pinnedSlots and
  // busyFaculty above are already narrowed to this (via
  // matchesCurrentSemester - a slot from a DIFFERENT prior semester never
  // blocks or gets treated as pinned for the one being built now), so
  // callers don't need to re-filter them; this is exposed mainly for
  // draft/publish routes to stamp onto what they write.
  currentSemester: number | null;
}

export async function loadTimetableContext(
  db: Firestore,
  collegeId: string,
  sectionId: string,
  // Overrides the date-resolved "current" semester for THIS section's own
  // course-year - the Timetable editor's own semester picker, letting an HOD
  // deliberately build/edit a semester other than whichever one today's date
  // falls in (see draft/route.ts). Every OTHER course-year (another
  // section's busyFaculty/pinnedSlots below) still resolves its own semester
  // naturally from today's date regardless - only the section actually being
  // edited is affected. `undefined` (the default) keeps the previous
  // date-only resolution; pass `null` explicitly for "no override, but I
  // considered it" call sites if that's ever needed.
  requestedSemester?: number | null,
): Promise<TimetableContext | null> {
  const collegeRef = db.collection("colleges").doc(collegeId);

  const sectionSnap = await collegeRef.collection("sections").doc(sectionId).get();
  if (!sectionSnap.exists) return null;
  const section = { id: sectionSnap.id, ...sectionSnap.data() } as Section;

  const [allTimingsSnap, rulesSnap, assignmentsSnap, subjectsSnap, allSlotsSnap] = await Promise.all([
    // Every course-year's timing, not just this section's own course - a
    // slot from ANOTHER section can belong to an entirely different course-
    // year with its own independent semester calendar (see "per course +
    // year" in CourseYearTiming.semesters), and busyFaculty below needs each
    // one resolved on its own terms, not against this section's dates. This
    // collection stays small (one doc per course x year in the college) so
    // fetching it whole is cheap next to the per-section queries below.
    collegeRef.collection("courseYearTimings").get(),
    collegeRef.collection("settings").doc("timetableRules").get(),
    collegeRef.collection("teachingAssignments").where("sectionId", "==", sectionId).get(),
    collegeRef.collection("subjects").where("courseId", "==", section.courseId).get(),
    // Every slot in the college: we need this section's pinned ones AND every
    // other section's slots, to keep a faculty from being double-booked across
    // sections. Generation is per-section, so this global view is what makes
    // section-at-a-time safe.
    collegeRef.collection("timetableSlots").get(),
  ]);

  const allTimings = allTimingsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as CourseYearTiming);
  let timing = allTimings.find((t) => t.courseId === section.courseId && Number(t.year) === Number(section.year)) ?? null;

  // A shared first year is configured once, on the common department that runs
  // it - but a section routed to a managed branch stores the BRANCH's course
  // id, so the exact match above misses it. Fall back to the course doc that
  // actually owns this year (see inheritedTimingCourseId, which returns null
  // for any year the department owns itself, so nothing else is affected).
  if (!timing) {
    const [coursesSnap, deptsSnap] = await Promise.all([
      collegeRef.collection("courses").get(),
      collegeRef.collection("departments").get(),
    ]);
    const courses = coursesSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Course[];
    const departments = deptsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as (Department & { id: string })[];
    const ownCourse = courses.find((c) => c.id === section.courseId);
    const inheritedId = ownCourse
      ? inheritedTimingCourseId(ownCourse, Number(section.year), departments, courses)
      : null;
    if (inheritedId) {
      timing = allTimings.find((t) => t.courseId === inheritedId && Number(t.year) === Number(section.year)) ?? null;
    }
  }

  const now = new Date();
  // Every distinct course-year's OWN current semester, keyed the same way a
  // TimetableSlot identifies its course-year - resolved once here so slots
  // below can be filtered against the semester calendar that actually
  // governs THEM, not this section's. A course-year with no timing doc at
  // all (shouldn't normally happen once a slot exists for it, but the map
  // simply has no entry then) falls through matchesCurrentSemester's own
  // null-is-always-current rule.
  const currentSemesterByCourseYear = new Map<string, number | null>(
    allTimings.map((t) => [`${t.courseId}_${t.year}`, resolveCurrentSemester(t, now)])
  );
  // The override, if given, replaces THIS section's own course-year entry in
  // the map too - so pinnedSlots/busyFaculty below (which check every slot
  // against its own course-year's entry) treat the section being edited as
  // belonging to the requested semester, not today's, while every other
  // section/course-year is unaffected.
  if (requestedSemester !== undefined) {
    currentSemesterByCourseYear.set(`${section.courseId}_${section.year}`, requestedSemester);
  }
  const currentSemester = currentSemesterByCourseYear.get(`${section.courseId}_${section.year}`) ?? null;

  const rules: TimetableRules = rulesSnap.exists
    ? { ...DEFAULT_TIMETABLE_RULES, ...(rulesSnap.data() as Partial<TimetableRules>) }
    : DEFAULT_TIMETABLE_RULES;

  const assignments = assignmentsSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() }) as TeachingAssignment,
  );

  const allCourseSubjects = subjectsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Subject);
  const courseYearSubjects = allCourseSubjects.filter(
    (s) => Number(s.year) === Number(section.year),
  );
  const subjectsById = new Map(allCourseSubjects.map((s) => [s.id, s]));

  const allSlotsRaw = allSlotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot);

  // A slot from a DIFFERENT, prior semester of ITS OWN course-year (see
  // CourseYearTiming.semesters) is history, not something the current build
  // has to work around or that should block a faculty member's availability
  // now - excluded up front so neither pinnedSlots nor busyFaculty below
  // ever "see" it. Each slot is checked against its OWN course-year's
  // current semester (currentSemesterByCourseYear), not this section's -
  // two different courses can be in different semesters (or none) at once.
  const allSlots = allSlotsRaw.filter((s) => {
    const slotCurrentSemester = currentSemesterByCourseYear.get(`${s.courseId}_${s.year}`) ?? null;
    return matchesCurrentSemester(s.semester, slotCurrentSemester);
  });

  // Slots written before `source` existed are manual by definition - the only
  // way to create one back then was the per-faculty picker. Treat them as pinned
  // so an upgrade never silently discards someone's hand-built timetable.
  const isPinned = (s: TimetableSlot) => s.source !== "GENERATED";

  const pinnedSlots = allSlots.filter((s) => s.sectionId === sectionId && isPinned(s));

  const busyFaculty = new Map<string, Set<string>>();
  for (const s of allSlots) {
    if (s.sectionId === sectionId) continue;   // this section's own slots are being replaced
    let cells = busyFaculty.get(s.facultyId);
    if (!cells) { cells = new Set(); busyFaculty.set(s.facultyId, cells); }
    cells.add(`${s.day}:${s.periodNumber}`);
  }
  // A faculty is equally unavailable during this section's own pinned slots.
  for (const s of pinnedSlots) {
    let cells = busyFaculty.get(s.facultyId);
    if (!cells) { cells = new Set(); busyFaculty.set(s.facultyId, cells); }
    cells.add(`${s.day}:${s.periodNumber}`);
  }

  return {
    section, timing, rules, assignments, courseYearSubjects, subjectsById, pinnedSlots, busyFaculty, currentSemester,
  };
}

/** "DAY:period" keys occupied by this section's pinned slots. */
export function pinnedCells(pinnedSlots: TimetableSlot[]): Set<string> {
  return new Set(pinnedSlots.map((s) => `${s.day}:${s.periodNumber}`));
}
