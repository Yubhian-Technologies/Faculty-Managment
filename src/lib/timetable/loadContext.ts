import { FieldPath, type Firestore } from "firebase-admin/firestore";
import type {
  CourseYearTiming, FacultyAssignmentRequest, Section, Subject, TeachingAssignment, TimetableDraft, TimetableRules,
  TimetableSlot,
} from "@/types";
import { DEFAULT_TIMETABLE_RULES } from "@/types";
import { resolveCurrentSemester, matchesCurrentSemester } from "@/lib/college/semester";
import { declaredBusyByFaculty } from "@/lib/timetable/declaredBusy";
import { inheritedTimingCourseId } from "@/lib/timetable/sharedYearTiming";
import { chunkValues, getInChunks } from "@/lib/firestore/inQuery";
import { cachedCollectionDocs } from "@/lib/firestore/sharedReads";
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
  /**
   * facultyId -> "DAY:period" cells busy in ANY other section - from that
   * section's own PUBLISHED timetableSlots, AND from its still-unpublished
   * timetableDrafts (see the draft query below). Without the latter, two
   * HODs (or one HOD editing two sections back to back) could each place the
   * same faculty into an overlapping period because neither section's
   * in-progress draft is visible to the other until someone actually
   * publishes - the publish-time re-check (publish/route.ts) only catches it
   * once ONE of the two has already gone live, not while both are still
   * drafts.
   *
   * Only populated for the faculty who actually have an assignment on THIS
   * section - the only ones a placement here can ever involve - rather than for
   * every faculty member in the college.
   */
  busyFaculty: Map<string, Set<string>>;
  /**
   * Cells a lending department declared busy (see
   * FacultyAssignmentRequest.busyPeriods). Advisory only: NOT part of
   * busyFaculty, so it never rejects a placement - callers may surface it as
   * a heads-up.
   */
  declaredBusyFaculty: Map<string, Set<string>>;
  // Resolved once from `timing` - null when this course-year has no
  // semesters configured (see CourseYearTiming.semesters). pinnedSlots and
  // busyFaculty above are already narrowed to this (via
  // matchesCurrentSemester - a slot from a DIFFERENT prior semester never
  // blocks or gets treated as pinned for the one being built now), so
  // callers don't need to re-filter them; this is exposed mainly for
  // draft/publish routes to stamp onto what they write.
  currentSemester: number | null;
}

/** Doc that says every timetableDrafts doc carries `facultyIds` - set only by scripts/backfill-timetable-draft-faculty-ids.mjs --apply. */
export const DRAFT_INDEX_MARKER = ["settings", "timetableDraftFacultyIndex"] as const;

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

  const [allTimingsSnap, rulesSnap, assignmentsSnap, subjectsSnap, allocatedRequestsSnap, draftIndexSnap] = await Promise.all([
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
    // ALLOCATED cross-department lends onto this section - see
    // FacultyAssignmentRequest.busyPeriods. The lending department never
    // places real TimetableSlot rows for these, so without this query their
    // declared-busy cells would be invisible to busyFaculty below.
    collegeRef.collection("facultyAssignmentRequests")
      .where("sectionId", "==", sectionId).where("status", "==", "ALLOCATED").get(),
    collegeRef.collection(DRAFT_INDEX_MARKER[0]).doc(DRAFT_INDEX_MARKER[1]).get(),
  ]);

  const assignments = assignmentsSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() }) as TeachingAssignment,
  );

  // Only these faculty can be placed in this section, so only their other
  // commitments matter. The whole college's slots and drafts used to be read
  // on EVERY edit (each drag/add/remove) to answer "is this one person free" -
  // cost grew with the size of the college, not with the question.
  const facultyIds = Array.from(new Set(assignments.map((a) => a.facultyId).filter((id): id is string => Boolean(id))));
  const draftsIndexed = draftIndexSnap.exists && (draftIndexSnap.data() as { ready?: boolean }).ready === true;

  const [ownSlotsSnap, facultySlotDocs, draftDocs] = await Promise.all([
    // This section's own slots - the pinned ones the generator works around.
    collegeRef.collection("timetableSlots").where("sectionId", "==", sectionId).get(),
    // Every slot of those faculty, in any section.
    getInChunks(facultyIds, (chunk) => collegeRef.collection("timetableSlots").where("facultyId", "in", chunk)),
    // Every OTHER section's in-progress draft that includes one of them, for
    // the same reason - a faculty already placed into another section's
    // still-unpublished draft is just as unavailable as one on a live
    // timetable, but invisible there until someone publishes it. Drafts hold
    // their slots in an array, so they can only be found by a denormalised
    // `facultyIds` field; until every draft is known to carry it (the backfill
    // script sets the marker doc), fall back to reading them all, exactly as
    // before. Small collection (one doc per section+semester).
    draftsIndexed
      ? getInChunks(facultyIds, (chunk) => collegeRef.collection("timetableDrafts").where("facultyIds", "array-contains-any", chunk))
      : facultyIds.length === 0
        ? Promise.resolve([])
        : collegeRef.collection("timetableDrafts").get().then((s) => s.docs),
  ]);

  const allTimings = allTimingsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as CourseYearTiming);
  let timing = allTimings.find((t) => t.courseId === section.courseId && Number(t.year) === Number(section.year)) ?? null;

  // A shared first year is configured once, on the common department that runs
  // it - but a section routed to a managed branch stores the BRANCH's course
  // id, so the exact match above misses it. Fall back to the course doc that
  // actually owns this year (see inheritedTimingCourseId, which returns null
  // for any year the department owns itself, so nothing else is affected).
  if (!timing) {
    const [courseDocs, deptDocs] = await Promise.all([
      cachedCollectionDocs(db, collegeId, "courses"),
      cachedCollectionDocs(db, collegeId, "departments"),
    ]);
    const courses = courseDocs.map((d) => ({ id: d.id, ...d.data() })) as Course[];
    const departments = deptDocs.map((d) => ({ id: d.id, ...d.data() })) as (Department & { id: string })[];
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

  const allCourseSubjects = subjectsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Subject);
  const courseYearSubjects = allCourseSubjects.filter(
    (s) => Number(s.year) === Number(section.year),
  );
  const subjectsById = new Map(allCourseSubjects.map((s) => [s.id, s]));

  // A cross-department lend (see faculty-assignment-requests) puts an
  // assignment on this section whose subject belongs to the LENDING
  // department's own Course doc, never section.courseId - the query above
  // misses it entirely, so subjectsById.get() below falls back to undefined
  // and callers (draft/route.ts's PRACTICAL blockSize/allowSplit gating)
  // silently treat a lent-in lab as THEORY. Back-fill by id whatever's
  // still missing rather than widening the query above and losing its
  // courseId scoping for courseYearSubjects (the "what should this course-
  // year run" list, which a lent-in subject never belongs on).
  const missingSubjectIds = Array.from(
    new Set(assignments.map((a) => a.subjectId).filter((id): id is string => Boolean(id) && !subjectsById.has(id))),
  );
  if (missingSubjectIds.length > 0) {
    const extraSnaps = await Promise.all(
      chunkValues(missingSubjectIds).map((ids) => collegeRef.collection("subjects").where(FieldPath.documentId(), "in", ids).get()),
    );
    for (const extraSnap of extraSnaps) {
      for (const d of extraSnap.docs) subjectsById.set(d.id, { id: d.id, ...d.data() } as Subject);
    }
  }

  const slotsById = new Map<string, TimetableSlot>();
  for (const d of ownSlotsSnap.docs) slotsById.set(d.id, { id: d.id, ...d.data() } as TimetableSlot);
  for (const d of facultySlotDocs) slotsById.set(d.id, { id: d.id, ...d.data() } as TimetableSlot);
  const allSlotsRaw = Array.from(slotsById.values());

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
  const markBusy = (facultyId: string, p: { day: string; periodNumber: number }) => {
    let cells = busyFaculty.get(facultyId);
    if (!cells) { cells = new Set(); busyFaculty.set(facultyId, cells); }
    cells.add(`${p.day}:${p.periodNumber}`);
  };
  for (const s of allSlots) {
    if (s.sectionId === sectionId) continue;   // this section's own slots are being replaced
    markBusy(s.facultyId, s);
  }
  // A faculty is equally unavailable during this section's own pinned slots.
  for (const s of pinnedSlots) markBusy(s.facultyId, s);
  // And during whatever ANOTHER section's own still-unpublished draft has
  // already placed them into - see the draft query above.
  // Same current-semester narrowing as allSlots, but resolved from each
  // draft doc's own courseId/year (a draft can predate the section doc being
  // reloaded, so this doesn't reuse `section`'s course-year). Every status
  // is included, not just "DRAFT" - a draft doc flips to "PUBLISHED" in
  // place and is reused for the next edit (see TimetableDraft.id's own
  // doc-comment), so its slots stay just as real a commitment either way;
  // double-counting a published one already covered by allSlots above is
  // harmless (busyFaculty cells are a Set).
  for (const d of draftDocs) {
    const otherDraft = d.data() as TimetableDraft;
    if (otherDraft.sectionId === sectionId) continue; // this section's own draft - handled via pinnedSlots/the caller's own `draft` argument
    const draftCurrentSemester = currentSemesterByCourseYear.get(`${otherDraft.courseId}_${otherDraft.year}`) ?? null;
    if (!matchesCurrentSemester(otherDraft.semester ?? null, draftCurrentSemester)) continue;
    for (const s of otherDraft.slots ?? []) {
      markBusy(s.facultyId, s);
    }
  }
  // What the lending department declared busy for an allocated faculty member
  // is ADVISORY only - kept separate from busyFaculty so it never blocks a
  // placement, the daily cap or the consecutive-period cap (see
  // FacultyAssignmentRequest.busyPeriods). Expanded through declaredBusy.ts so
  // an entry declared against another year's numbering lands on the right
  // period(s) of THIS section.
  const timingForYear = (y: number) =>
    allTimings.find((t) => t.courseId === section.courseId && Number(t.year) === y) ?? null;
  const declaredBusyFaculty = declaredBusyByFaculty(
    allocatedRequestsSnap.docs.map((d) => d.data() as FacultyAssignmentRequest),
    Number(section.year), timing, timingForYear,
  );

  return {
    section, timing, rules, assignments, courseYearSubjects, subjectsById, pinnedSlots,
    busyFaculty, declaredBusyFaculty, currentSemester,
  };
}

/** "DAY:period" keys occupied by this section's pinned slots. */
export function pinnedCells(pinnedSlots: TimetableSlot[]): Set<string> {
  return new Set(pinnedSlots.map((s) => `${s.day}:${s.periodNumber}`));
}
