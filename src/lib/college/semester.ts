import type { Firestore } from "firebase-admin/firestore";
import type { CourseYearTiming } from "@/types";

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

// Shared doc-id convention for colleges/{id}/timetableDrafts - == sectionId
// when the course-year has no semesters configured (or never did, the still
// very common case), `${sectionId}_sem${semester}` once it does, so building
// Semester 2 never clobbers Semester 1's own in-progress draft. Used by both
// timetable/draft/route.ts and timetable/publish/route.ts.
export function draftDocId(sectionId: string, semester: number | null): string {
  return semester == null ? sectionId : `${sectionId}_sem${semester}`;
}

// One-off, single-course-year resolution for routes that don't already have
// loadTimetableContext's full TimetableContext loaded (a plain draft
// GET/PATCH, or a read-only timetable view) - fetches just that one
// CourseYearTiming doc rather than the whole collection. Null when no timing
// doc exists at all for this course-year (same as no semesters configured).
export async function resolveSectionCurrentSemester(
  db: Firestore,
  collegeId: string,
  courseId: string,
  year: number,
  now: Date = new Date()
): Promise<number | null> {
  const snap = await db
    .collection("colleges").doc(collegeId)
    .collection("courseYearTimings").doc(`${courseId}_year${year}`)
    .get();
  if (!snap.exists) return null;
  return resolveCurrentSemester(snap.data() as CourseYearTiming, now);
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
  const snap = await db
    .collection("colleges").doc(collegeId)
    .collection("courseYearTimings").doc(`${courseId}_year${year}`)
    .get();
  const timing = snap.exists ? (snap.data() as CourseYearTiming) : null;

  if (requested == null) {
    return { ok: true, semester: resolveCurrentSemester(timing, now) };
  }
  const configured = (timing?.semesters ?? []).map((s) => s.semester);
  if (!configured.includes(requested)) {
    return { ok: false, error: "That semester isn't configured for this course-year" };
  }
  return { ok: true, semester: requested };
}
