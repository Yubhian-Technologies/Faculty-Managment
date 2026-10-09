import { MAX_FACULTY_PER_SUBJECT } from "@/lib/teaching/facultyCap";
import { pinnedCells, type TimetableContext } from "@/lib/timetable/loadContext";
import { isContiguousBlockAvailable, periodsFollowedByBreak } from "@/lib/timetable/buildGrid";
import type { DayOfWeek, DraftSlot } from "@/types";

// Only `slots` is ever read below, so any in-progress placement list - a real
// TimetableDraft, or a lightweight accumulator built while matching an
// imported grid before a draft document even exists - can be validated
// against without constructing a full TimetableDraft's other fields.
type SlotsHolder = { slots: DraftSlot[] };

// Shared hard-constraint logic for placing a teaching assignment into a
// TimetableDraft - used by the hand-edit "add"/"move" actions
// (api/college/timetable/draft PATCH) and by the timetable import flow
// (api/college/timetable/import/confirm), so both go through exactly the
// same checks a hand-built timetable would.

export const cellKey = (day: string, period: number) => `${day}:${period}`;

/** Longest run of consecutive integers present in `periods`. */
export function longestConsecutiveRun(periods: Set<number>): number {
  let max = 0;
  for (const p of periods) {
    if (periods.has(p - 1)) continue; // not the start of a run
    let run = 1;
    while (periods.has(p + run)) run++;
    max = Math.max(max, run);
  }
  return max;
}

/** Number of separate same-subject sessions in `periods` (a contiguous run counts once). */
export function countSessions(periods: Set<number>): number {
  let sessions = 0;
  for (const p of periods) if (!periods.has(p - 1)) sessions++;
  return sessions;
}

export function validatePlacement(
  ctx: TimetableContext,
  draft: SlotsHolder,
  opts: {
    facultyId: string;
    facultyName: string;
    subjectId: string;
    day: string;
    startPeriod: number;
    blockSize: number;
    ignore: Set<string>;
    // Overrides rules.allowLabAcrossBreaks for this one check - used by the
    // "add"/"move" retry below, which re-validates the SAME requested
    // periods with breaks allowed once the plain check rejects them for
    // that reason alone. Omitted uses the college's own configured rule.
    allowAcrossBreaks?: boolean;
    // Explicit opt-in for a split period (two+ subjects/faculty sharing one
    // section+day+period) - only ever set by the manual "add" action below
    // when a human deliberately chose to add another subject to an already-
    // occupied cell, never by the auto-generator. Skips ONLY the
    // already-occupied check; pinned/faculty-busy/daily-cap still apply.
    allowSplit?: boolean;
    // The assignment being placed, when known. A split period must be shared
    // by two DIFFERENT assignments: the same one twice in a cell would collide
    // on its attendance session (keyed by assignment, date and period).
    assignmentId?: string;
    // Co-teaching: the SAME subject placed in a cell that already holds it, for another
    // faculty of that subject ("place here with both faculty"). Works for any subject
    // type, theory included, unlike allowSplit, which only ever pairs two labs. Needs
    // `subjectId`; the cell may hold only this subject, never a different one.
    coTeach?: boolean;
  },
): string | null {
  const { timing, rules } = ctx;
  if (!timing) return "No period timing is configured for this course year.";
  const { day, startPeriod, blockSize, ignore } = opts;
  const allowAcrossBreaks = opts.allowAcrossBreaks ?? rules.allowLabAcrossBreaks;

  if (!rules.workingDays.includes(day as DayOfWeek)) return `${day} is not a working day.`;

  if (!isContiguousBlockAvailable(timing, startPeriod, blockSize, allowAcrossBreaks)) {
    return blockSize > 1
      ? `This lab needs ${blockSize} continuous periods; they do not fit at period ${startPeriod} without crossing a break.`
      : `Period ${startPeriod} is outside the ${timing.numberOfPeriods}-period day.`;
  }

  const pinned = pinnedCells(ctx.pinnedSlots);
  const occupied = new Set(
    draft.slots
      .map((s) => cellKey(s.day, s.periodNumber))
      .filter((k) => !ignore.has(k)),
  );

  for (let i = 0; i < blockSize; i++) {
    const p = startPeriod + i;
    const key = cellKey(day, p);
    if (pinned.has(key)) return `Period ${p} on ${day} holds a pinned slot.`;
    if (occupied.has(key) && !opts.allowSplit && !opts.coTeach) return `This section already has a subject at ${day} period ${p}.`;
    if (occupied.has(key) && opts.coTeach) {
      const existing = draft.slots.filter((s) => s.day === day && s.periodNumber === p);
      const sameSubject = existing.filter((s) => s.subjectId === opts.subjectId);
      // Besides this subject, the cell may only hold ONE other lab, and only when this subject is a lab too
      // (two labs sharing a period, each with its own faculty).
      const others = existing.filter((s) => s.subjectId !== opts.subjectId);
      if (others.length > 0) {
        const typeOf = (id: string) => ctx.subjectsById.get(id)?.type;
        const labsOnly = typeOf(opts.subjectId) === "PRACTICAL" && others.every((s) => typeOf(s.subjectId) === "PRACTICAL");
        if (!labsOnly) return `Period ${p} on ${day} holds a different subject - faculty can only share a period for the same subject.`;
        if (new Set([...existing.map((s) => s.subjectId), opts.subjectId]).size > 2) {
          return `Period ${p} on ${day} already has 2 labs sharing it - a period can only be split between two labs.`;
        }
      }
      if (opts.assignmentId && existing.some((s) => s.assignmentId === opts.assignmentId)) {
        return `This faculty is already placed at ${day} period ${p}.`;
      }
      if (sameSubject.length >= MAX_FACULTY_PER_SUBJECT) return `Period ${p} on ${day} already has ${sameSubject.length} faculty for this subject.`;
    } else if (occupied.has(key) && opts.allowSplit) {
      // A period may only be split between two subjects of the SAME
      // splittable kind - two labs (parallel batches), or two non-teaching
      // subjects (Counselling, Mentoring, NSS, ...) - never a mix of the
      // two, and at most two share it. The incoming subject's own kind is
      // checked by the caller (draft/route.ts) before this runs.
      const existing = draft.slots.filter((s) => s.day === day && s.periodNumber === p);
      // Two subjects may share a period; each may have several faculty, so count subjects, not entries.
      const existingSubjectIds = new Set(existing.map((s) => s.subjectId));
      const incomingType = ctx.subjectsById.get(opts.subjectId)?.type;
      const isNonTeaching = incomingType === "NON_TEACHING";
      if (existingSubjectIds.size >= 2 && !existingSubjectIds.has(opts.subjectId)) {
        return isNonTeaching
          ? `Period ${p} on ${day} already has 2 non-teaching subjects sharing it - a period can only be split between two.`
          : `Period ${p} on ${day} already has 2 labs sharing it - a period can only be split between two labs.`;
      }
      const splittable = incomingType === "PRACTICAL" || isNonTeaching;
      if (!splittable || existing.some((s) => ctx.subjectsById.get(s.subjectId)?.type !== incomingType)) {
        return isNonTeaching
          ? `Period ${p} on ${day} holds a subject that isn't non-teaching - a period can only be split between two non-teaching subjects.`
          : `Period ${p} on ${day} holds a non-lab subject - a period can only be split between lab subjects.`;
      }
    }
    // No "already teaching another section" check: years run their own period
    // timings, so the same faculty may hold the same period number in two
    // sections. facultyBusy still feeds the daily/consecutive caps below.
  }

  // No faculty caps: a faculty member may take any number of periods in a day,
  // consecutive or not.

  // No per-subject daily cap: the same subject may be placed any number of
  // times (or sessions) in a day.

  return null;
}

/** The contiguous run of slots that belong to one placement (a lab block or a single period). */
export function blockAt(draft: SlotsHolder, assignmentId: string, day: string, period: number): DraftSlot[] {
  const anchor = draft.slots.find(
    (s) => s.assignmentId === assignmentId && s.day === day && s.periodNumber === period,
  );
  if (!anchor) return [];

  let start = anchor;
  while (start.isBlockContinuation) {
    const prev = draft.slots.find(
      (s) => s.assignmentId === assignmentId && s.day === day && s.periodNumber === start.periodNumber - 1,
    );
    if (!prev) break;
    start = prev;
  }

  const block = [start];
  for (let p = start.periodNumber + 1; ; p++) {
    const next = draft.slots.find(
      (s) => s.assignmentId === assignmentId && s.day === day && s.periodNumber === p && s.isBlockContinuation,
    );
    if (!next) break;
    block.push(next);
  }
  return block;
}

/**
 * When a multi-period lab placement fails specifically because a break falls
 * INSIDE it - not because of a day-boundary, an occupied cell, a faculty
 * conflict, or the daily cap - retries the EXACT SAME requested periods with
 * that break allowed, instead of rejecting outright. A 3-period lab clicked
 * starting where a short break/lunch falls between two of its periods (e.g.
 * periods 1-2, then a break, then period 3) is a completely normal way to
 * run a lab in practice - the break is just a natural pause partway through,
 * not a reason to bounce the whole block to a different time. Never touches
 * a same-day placement failure for any OTHER reason (those still reject as
 * before), and never relocates the block - it always lands on exactly the
 * periods that were clicked/dragged to.
 *
 * Returns `{ ok: true }` when the break-crossing placement is fine, or
 * `{ ok: false, problem }` where `problem` is the ORIGINAL (break-crossing)
 * error when there was no break involved at all, but the RETRY's own error
 * (e.g. "already teaching another section at period 3") when the block still
 * can't go there for some other reason even with the break allowed - so the
 * message the caller ever sees always names the real blocker, never a stale
 * "crossing a break" message once the break itself was never the problem.
 */
export function checkPlacementAcrossBreak(
  ctx: TimetableContext,
  draft: SlotsHolder,
  opts: {
    facultyId: string;
    facultyName: string;
    subjectId: string;
    day: string;
    startPeriod: number;
    blockSize: number;
    ignore: Set<string>;
  },
  originalProblem: string,
): { ok: true } | { ok: false; problem: string } {
  const { timing, rules } = ctx;
  if (!timing || rules.allowLabAcrossBreaks || opts.blockSize <= 1) {
    return { ok: false, problem: originalProblem };
  }
  const breaks = periodsFollowedByBreak(timing);
  const hasInteriorBreak = Array.from(
    { length: opts.blockSize - 1 },
    (_, i) => opts.startPeriod + i,
  ).some((p) => breaks.has(p));
  // The failure wasn't about a break at all (occupied/busy/day-boundary/cap) -
  // nothing to override, the original error already names the real reason.
  if (!hasInteriorBreak) return { ok: false, problem: originalProblem };
  const retryProblem = validatePlacement(ctx, draft, { ...opts, allowAcrossBreaks: true });
  return retryProblem ? { ok: false, problem: retryProblem } : { ok: true };
}
