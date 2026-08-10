import type { Firestore } from "firebase-admin/firestore";
import type {
  CourseYearTiming, Section, Subject, TeachingAssignment, TimetableRules, TimetableSlot,
} from "@/types";
import { DEFAULT_TIMETABLE_RULES } from "@/types";

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
}

export async function loadTimetableContext(
  db: Firestore,
  collegeId: string,
  sectionId: string,
): Promise<TimetableContext | null> {
  const collegeRef = db.collection("colleges").doc(collegeId);

  const sectionSnap = await collegeRef.collection("sections").doc(sectionId).get();
  if (!sectionSnap.exists) return null;
  const section = { id: sectionSnap.id, ...sectionSnap.data() } as Section;

  const [timingsSnap, rulesSnap, assignmentsSnap, subjectsSnap, allSlotsSnap] = await Promise.all([
    collegeRef.collection("courseYearTimings").where("courseId", "==", section.courseId).get(),
    collegeRef.collection("settings").doc("timetableRules").get(),
    collegeRef.collection("teachingAssignments").where("sectionId", "==", sectionId).get(),
    collegeRef.collection("subjects").where("courseId", "==", section.courseId).get(),
    // Every slot in the college: we need this section's pinned ones AND every
    // other section's slots, to keep a faculty from being double-booked across
    // sections. Generation is per-section, so this global view is what makes
    // section-at-a-time safe.
    collegeRef.collection("timetableSlots").get(),
  ]);

  const timing =
    timingsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as unknown as CourseYearTiming)
      .find((t) => Number(t.year) === Number(section.year)) ?? null;

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

  const allSlots = allSlotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot);

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
    section, timing, rules, assignments, courseYearSubjects, subjectsById, pinnedSlots, busyFaculty,
  };
}

/** "DAY:period" keys occupied by this section's pinned slots. */
export function pinnedCells(pinnedSlots: TimetableSlot[]): Set<string> {
  return new Set(pinnedSlots.map((s) => `${s.day}:${s.periodNumber}`));
}
