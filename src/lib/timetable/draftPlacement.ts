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
  },
): string | null {
  const { timing, rules } = ctx;
  if (!timing) return "No period timing is configured for this course year.";
  const { facultyId, facultyName, subjectId, day, startPeriod, blockSize, ignore } = opts;
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
  const facultyBusy = ctx.busyFaculty.get(facultyId) ?? new Set<string>();
  const facultyDeclaredBusy = ctx.declaredBusyFaculty.get(facultyId) ?? new Set<string>();

  for (let i = 0; i < blockSize; i++) {
    const p = startPeriod + i;
    const key = cellKey(day, p);
    if (pinned.has(key)) return `Period ${p} on ${day} holds a pinned slot.`;
    if (occupied.has(key) && !opts.allowSplit) return `This section already has a subject at ${day} period ${p}.`;
    if (occupied.has(key) && opts.allowSplit) {
      // A period may only be split between labs: every subject already in it
      // must be PRACTICAL too (the incoming one is checked by the caller),
      // and at most two share it.
      const existing = draft.slots.filter((s) => s.day === day && s.periodNumber === p);
      if (existing.length >= 2) return `Period ${p} on ${day} already has 2 subjects sharing it - a period can only be split between two labs.`;
      if (existing.some((s) => ctx.subjectsById.get(s.subjectId)?.type !== "PRACTICAL")) {
        return `Period ${p} on ${day} holds a non-lab subject - a period can only be split between lab subjects.`;
      }
    }
    // A lending department's own busyPeriods declaration (see
    // AssignmentRequestsPanel) never created a real TimetableSlot anywhere -
    // "already teaching another section" would be misleading for it, so this
    // gets its own, accurate wording instead.
    if (facultyDeclaredBusy.has(key)) {
      return `${facultyName} already has a period on ${day} period ${p}.`;
    }
    // No "already teaching another section" check: years run their own period
    // timings, so the same faculty may hold the same period number in two
    // sections. facultyBusy still feeds the daily/consecutive caps below.
  }

  // Per-faculty daily cap: the rest of this draft, plus other sections.
  const sameDay = draft.slots.filter(
    (s) => s.facultyId === facultyId && s.day === day && !ignore.has(cellKey(s.day, s.periodNumber)),
  ).length;
  const otherSections = Array.from(facultyBusy).filter((c) => c.startsWith(`${day}:`)).length;
  if (sameDay + otherSections + blockSize > rules.maxPeriodsPerFacultyPerDay) {
    return `${facultyName} would exceed the ${rules.maxPeriodsPerFacultyPerDay} periods/day limit on ${day}.`;
  }

  // Per-faculty consecutive-period cap: this section's own draft placements
  // for this faculty on this day, plus every other section's (busyFaculty),
  // plus the block being placed - a faculty back-to-back across two
  // different sections is just as much "consecutive" as within one.
  const facultyDayPeriods = new Set<number>();
  for (const cell of facultyBusy) {
    const [cellDay, cellPeriod] = cell.split(":");
    if (cellDay === day) facultyDayPeriods.add(Number(cellPeriod));
  }
  for (const s of draft.slots) {
    if (s.facultyId === facultyId && s.day === day && !ignore.has(cellKey(s.day, s.periodNumber))) {
      facultyDayPeriods.add(s.periodNumber);
    }
  }
  for (let i = 0; i < blockSize; i++) facultyDayPeriods.add(startPeriod + i);
  const longestRun = longestConsecutiveRun(facultyDayPeriods);
  if (longestRun > rules.maxConsecutivePeriodsPerFaculty) {
    return `${facultyName} would have ${longestRun} consecutive periods on ${day}, exceeding the ${rules.maxConsecutivePeriodsPerFaculty}-period limit.`;
  }

  // Per-subject daily repeat cap, for this section only - a contiguous lab
  // block counts as one session, not one per period (see countSessions).
  const subjectDayPeriods = new Set<number>();
  for (const s of draft.slots) {
    if (s.subjectId === subjectId && s.day === day && !ignore.has(cellKey(s.day, s.periodNumber))) {
      subjectDayPeriods.add(s.periodNumber);
    }
  }
  for (let i = 0; i < blockSize; i++) subjectDayPeriods.add(startPeriod + i);
  const sessionCount = countSessions(subjectDayPeriods);
  if (sessionCount > rules.maxPeriodsPerSubjectPerDay) {
    return `This subject would be scheduled ${sessionCount} separate times on ${day}, exceeding the ${rules.maxPeriodsPerSubjectPerDay}/day limit.`;
  }

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
