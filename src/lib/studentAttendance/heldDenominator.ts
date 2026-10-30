import type { Firestore } from "firebase-admin/firestore";
import type { DayOfWeek } from "@/types";
import { istDateKey } from "@/lib/attendance/istTime";
import { loadClassCalendar as loadCalendar } from "@/lib/studentAttendance/classDay";
import { matchesCurrentSemester } from "@/lib/college/semester";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import { makeLiveSlotPredicate } from "@/lib/timetable/liveSlots";
import { loadTimingLookup, periodInterval, formatInterval } from "@/lib/timetable/facultyOverlap";
import { loadMidWindows } from "@/lib/timetable/slotScope";
import { calcPercent } from "@/lib/studentAttendance/percentage";
import {
  buildNotPostedIndex, listExpectedPeriods, notPostedOf, postedKeysOf, type Calendar, type ExpectedSlot, type NotPostedIndex,
} from "@/lib/studentAttendance/expectedPeriods";
import type { AcademicYearWindow } from "@/lib/studentAttendance/academicYearWindow";

// Which "classes held" definition a student-attendance report uses.
//
//   SUBMITTED (default)  held = periods with a SUBMITTED session. The original
//                        numbers, unchanged - a period nobody posted is invisible.
//   TIMETABLE            held = SUBMITTED sessions PLUS the published-timetable
//                        periods that should have run but have no submitted
//                        session ("not posted"). Nobody is marked present for
//                        those. See expectedPeriods.ts for what that means and
//                        what it deliberately does not cover.
//
// The mode is chosen per request (`?denominator=timetable|submitted`), else by
// the college's own setting (settings/studentAttendance.heldDenominator), else
// SUBMITTED - so nothing changes for anyone until one of those says so. A
// report can also ask for `compare=true` to get BOTH numbers side by side,
// which is how the switch should be evaluated before it is made.

export type HeldDenominatorMode = "SUBMITTED" | "TIMETABLE";

export function parseDenominatorParam(v: string | null | undefined): HeldDenominatorMode | null {
  const p = (v ?? "").trim().toLowerCase();
  if (p === "timetable") return "TIMETABLE";
  if (p === "submitted") return "SUBMITTED";
  return null;
}

export async function resolveDenominatorMode(db: Firestore, collegeId: string, param: string | null | undefined): Promise<HeldDenominatorMode> {
  const fromParam = parseDenominatorParam(param);
  if (fromParam) return fromParam;
  const snap = await db.collection("colleges").doc(collegeId).collection("settings").doc("studentAttendance").get();
  const configured = (snap.data() as { heldDenominator?: string } | undefined)?.heldDenominator;
  return configured === "TIMETABLE" ? "TIMETABLE" : "SUBMITTED";
}

export interface DenominatorResult {
  index: NotPostedIndex;
  /** Subject names from the timetable slots, so a subject nobody has posted yet can still get a column. */
  subjects?: Map<string, { subjectName: string; subjectCode: string }>;
  /** Why the timetable denominator could not be built, when it could not (index is then empty). */
  unavailable?: "PAST_YEAR" | "NO_TIMETABLE";
  /** The IST window it actually covers. */
  from?: string;
  to?: string;
}

const EMPTY = buildNotPostedIndex([]);

function toISTDate(value: unknown): string | null {
  const d = value && typeof (value as { toDate?: unknown }).toDate === "function"
    ? (value as { toDate(): Date }).toDate()
    : value instanceof Date ? value : null;
  return d ? istDateKey(d) : null;
}

export const loadClassCalendar: (db: Firestore, collegeId: string, fromISO: string, toISO: string) => Promise<Calendar> = loadCalendar;

/**
 * The not-posted periods of ONE section in [from, to] (clipped to today and,
 * if given, to the academic-year window), as an index that answers "how many
 * extra held periods does this student have, per subject".
 *
 * Only built for the CURRENT academic year: the published timetable describes
 * the current cohort, so projecting it onto a past year would invent classes.
 */
export async function loadNotPostedIndex(args: {
  db: Firestore;
  collegeId: string;
  section: { id: string; courseId: string; year: number };
  from: string;
  to: string;
  window: AcademicYearWindow | null;
  requestedSemester: number | null;
  submittedSessions: { assignmentId: string; date: string; periodNumber?: number | null }[];
  now?: Date;
}): Promise<DenominatorResult> {
  const { db, collegeId, section } = args;
  const now = args.now ?? new Date();
  if (args.window && !args.window.isCurrent) return { index: EMPTY, unavailable: "PAST_YEAR" };

  const from = args.window && args.window.from > args.from ? args.window.from : args.from;
  const to = args.window && args.window.to < args.to ? args.window.to : args.to;
  if (from > to) return { index: EMPTY, from, to };

  const currentAcademicYear = await resolveCollegeAcademicYear(db, collegeId, now);
  const [slotsSnap, { lookup }] = await Promise.all([
    db.collection("colleges").doc(collegeId).collection("timetableSlots").where("sectionId", "==", section.id).get(),
    loadTimingLookup(db, collegeId, [{ courseId: section.courseId, year: section.year }]),
  ]);
  const isLive = makeLiveSlotPredicate(lookup, currentAcademicYear, { now });

  const slots: ExpectedSlot[] = [];
  const subjects = new Map<string, { subjectName: string; subjectCode: string }>();
  let midScopedSemester: number | null | undefined;
  for (const d of slotsSnap.docs) {
    const s = d.data() as {
      subjectName?: string;
      assignmentId: string; subjectId: string; day: DayOfWeek; periodNumber: number; labBatch?: string; midScope?: number;
      semester?: number | null; academicYear?: string | null; courseId: string; year: number; createdAt?: unknown;
    };
    if (!isLive(s)) continue;
    if (args.requestedSemester != null && !matchesCurrentSemester(s.semester, args.requestedSemester)) continue;
    if (!subjects.has(s.subjectId)) subjects.set(s.subjectId, { subjectName: s.subjectName ?? "", subjectCode: "" });
    const interval = periodInterval(lookup(s.courseId, s.year), s.periodNumber);
    if (s.midScope != null && midScopedSemester === undefined) midScopedSemester = s.semester ?? null;
    slots.push({
      assignmentId: s.assignmentId, subjectId: s.subjectId, day: s.day, periodNumber: s.periodNumber, labBatch: s.labBatch,
      activeFromISO: toISTDate(s.createdAt),
      endTime: interval ? formatInterval(interval).split("-")[1] : null,
      ...(s.midScope != null ? { midScope: s.midScope } : {}),
    });
  }
  if (slots.length === 0) return { index: EMPTY, unavailable: "NO_TIMETABLE", from, to };

  const calendar = await loadClassCalendar(db, collegeId, from, to);
  // Mid windows are read only when the section actually has a mid-scoped slot.
  const midWindows = midScopedSemester === undefined
    ? undefined
    : await loadMidWindows(db, collegeId, { courseId: section.courseId, year: section.year, semester: midScopedSemester });
  const expected = listExpectedPeriods({ slots, from, to, calendar, now, midWindows });
  const notPosted = notPostedOf(expected, postedKeysOf(args.submittedSessions));
  return { index: buildNotPostedIndex(notPosted), subjects, from, to };
}

/** Held/attended/percentage of one student's per-subject tally with the not-posted periods added to `held`. */
export function withNotPosted(
  tally: { held: number; attended: number } | undefined,
  notPostedForSubject: number
): { held: number; attended: number; percentage: number | null } {
  const held = (tally?.held ?? 0) + notPostedForSubject;
  const attended = tally?.attended ?? 0;
  return { held, attended, percentage: calcPercent(attended, held) };
}

/**
 * One student's per-subject numbers under BOTH definitions, ordered as
 * main (the requested mode) and alt (the other one) - what the reports show,
 * and what `compare=true` adds beside it. `extra` is the not-posted periods
 * that count against this student for this subject.
 */
export function denominatorNumbers(
  tally: { held: number; attended: number } | undefined,
  extra: number,
  mode: HeldDenominatorMode
): {
  main: { held: number; attended: number; percentage: number | null };
  alt: { mode: HeldDenominatorMode; held: number; attended: number; percentage: number | null };
} {
  const submitted = { held: tally?.held ?? 0, attended: tally?.attended ?? 0, percentage: calcPercent(tally?.attended ?? 0, tally?.held ?? 0) };
  const timetable = withNotPosted(tally, extra);
  return mode === "TIMETABLE"
    ? { main: timetable, alt: { mode: "SUBMITTED", ...submitted } }
    : { main: submitted, alt: { mode: "TIMETABLE", ...timetable } };
}
