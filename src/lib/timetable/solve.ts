import type { CourseYearTiming, DayOfWeek, DraftSlot, TimetableRules } from "@/types";
import { isContiguousBlockAvailable, periodNumbers } from "./buildGrid";
import type { Demand } from "./buildDemands";

// Backtracking constraint solver. Pure - no I/O, no Firestore, no React - so it
// can be reasoned about and exercised in isolation.
//
// HARD constraints (never violated; failure is reported instead):
//   1. A section has at most one subject per (day, period).
//   2. A faculty is never in two places at once - checked against BOTH this
//      section's placements and `busyFaculty` (other sections already published).
//   3. PRACTICAL subjects occupy `blockSize` contiguous periods, not crossing a
//      break unless rules.allowLabAcrossBreaks.
//   4. Per-faculty per-day cap, per-faculty consecutive-period cap, and
//      per-subject per-day cap.
// Exact weekly hours is structural: every demand must be placed or we fail.
//
// SOFT preferences only order candidate cells, never gate them.

/** "MON:3" - one occupied period. */
type CellKey = string;
const cell = (day: DayOfWeek, period: number): CellKey => `${day}:${period}`;

export interface SolveInput {
  timing: CourseYearTiming;
  rules: TimetableRules;
  demands: Demand[];
  /** Cells this section already uses via pinned/manual slots - not placeable. */
  pinnedCells: Set<CellKey>;
  /** facultyId -> cells that faculty is already busy in, from ANY section. */
  busyFaculty: Map<string, Set<CellKey>>;
  /** Deterministic runs in tests; omit for randomised restarts. */
  seed?: number;
}

export type SolveResult =
  | { ok: true; slots: DraftSlot[]; diagnostics: string[] }
  | { ok: false; slots: null; diagnostics: string[] };

/** Small deterministic PRNG so restarts are reproducible when seeded. */
function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface Placement {
  demand: Demand;
  day: DayOfWeek;
  startPeriod: number;
}

/** Every (day, startPeriod) this demand could legally occupy, ignoring conflicts. */
function candidateCells(
  demand: Demand,
  timing: CourseYearTiming,
  rules: TimetableRules,
): { day: DayOfWeek; startPeriod: number }[] {
  const out: { day: DayOfWeek; startPeriod: number }[] = [];
  const periods = periodNumbers(timing);

  for (const day of rules.workingDays) {
    for (const start of periods) {
      if (demand.blockSize > 1) {
        if (!isContiguousBlockAvailable(timing, start, demand.blockSize, rules.allowLabAcrossBreaks)) {
          continue;
        }
      } else if (start > timing.numberOfPeriods) {
        continue;
      }
      out.push({ day, startPeriod: start });
    }
  }
  return out;
}

/** Soft-preference score - higher is better. Never affects legality. */
function score(
  demand: Demand,
  day: DayOfWeek,
  startPeriod: number,
  timing: CourseYearTiming,
  rules: TimetableRules,
  usedDaysBySubject: Map<string, Set<DayOfWeek>>,
): number {
  let s = 0;
  if (rules.preferTheoryInMorning && demand.subjectType === "THEORY") {
    // Earlier periods score higher, scaled so it never dominates spreading.
    s += (timing.numberOfPeriods - startPeriod) * 2;
  }
  if (rules.spreadSubjectsAcrossWeek) {
    const days = usedDaysBySubject.get(demand.subjectId);
    if (!days || !days.has(day)) s += 10;
  }
  return s;
}

function attempt(input: SolveInput, rnd: () => number): Placement[] | null {
  const { timing, rules, demands, pinnedCells, busyFaculty } = input;

  const sectionUsed = new Set<CellKey>(pinnedCells);
  // Clone so a failed attempt never leaks state into the next restart.
  const facultyUsed = new Map<string, Set<CellKey>>();
  for (const [fid, cells] of busyFaculty) facultyUsed.set(fid, new Set(cells));

  const facultyPerDay = new Map<string, number>();       // `${facultyId}:${day}`
  const subjectPerDay = new Map<string, number>();       // `${subjectId}:${day}`
  const usedDaysBySubject = new Map<string, Set<DayOfWeek>>();

  const placements: Placement[] = [];

  // Precompute candidates once; MRV re-reads them each step.
  const candidates = new Map<string, { day: DayOfWeek; startPeriod: number }[]>();
  for (const d of demands) candidates.set(d.key, candidateCells(d, timing, rules));

  const remaining = [...demands];

  function fits(d: Demand, day: DayOfWeek, start: number): boolean {
    const fUsed = facultyUsed.get(d.facultyId);

    for (let p = start; p < start + d.blockSize; p++) {
      const k = cell(day, p);
      if (sectionUsed.has(k)) return false;             // section double-booked
      if (fUsed?.has(k)) return false;                  // faculty double-booked
    }

    const dayCount = facultyPerDay.get(`${d.facultyId}:${day}`) ?? 0;
    if (dayCount + d.blockSize > rules.maxPeriodsPerFacultyPerDay) return false;

    const subjCount = subjectPerDay.get(`${d.subjectId}:${day}`) ?? 0;
    // A lab block counts as one occurrence of the subject that day, not N.
    const occurrences = d.blockSize > 1 ? 1 : 1;
    if (subjCount + occurrences > rules.maxPeriodsPerSubjectPerDay && d.subjectType !== "PRACTICAL") {
      return false;
    }

    // Consecutive-period cap for this faculty across the whole day.
    if (rules.maxConsecutivePeriodsPerFaculty > 0) {
      const occupied = new Set<number>();
      for (const p of periodNumbers(timing)) {
        if (fUsed?.has(cell(day, p))) occupied.add(p);
      }
      for (let p = start; p < start + d.blockSize; p++) occupied.add(p);
      let run = 0;
      for (const p of periodNumbers(timing)) {
        run = occupied.has(p) ? run + 1 : 0;
        if (run > rules.maxConsecutivePeriodsPerFaculty) return false;
      }
    }

    return true;
  }

  function apply(d: Demand, day: DayOfWeek, start: number) {
    let fUsed = facultyUsed.get(d.facultyId);
    if (!fUsed) { fUsed = new Set(); facultyUsed.set(d.facultyId, fUsed); }
    for (let p = start; p < start + d.blockSize; p++) {
      sectionUsed.add(cell(day, p));
      fUsed.add(cell(day, p));
    }
    facultyPerDay.set(`${d.facultyId}:${day}`, (facultyPerDay.get(`${d.facultyId}:${day}`) ?? 0) + d.blockSize);
    subjectPerDay.set(`${d.subjectId}:${day}`, (subjectPerDay.get(`${d.subjectId}:${day}`) ?? 0) + 1);
    let days = usedDaysBySubject.get(d.subjectId);
    if (!days) { days = new Set(); usedDaysBySubject.set(d.subjectId, days); }
    days.add(day);
  }

  function undo(d: Demand, day: DayOfWeek, start: number) {
    const fUsed = facultyUsed.get(d.facultyId);
    for (let p = start; p < start + d.blockSize; p++) {
      sectionUsed.delete(cell(day, p));
      fUsed?.delete(cell(day, p));
    }
    facultyPerDay.set(`${d.facultyId}:${day}`, (facultyPerDay.get(`${d.facultyId}:${day}`) ?? 0) - d.blockSize);
    subjectPerDay.set(`${d.subjectId}:${day}`, (subjectPerDay.get(`${d.subjectId}:${day}`) ?? 0) - 1);
  }

  // Bound the search so a pathological input can't hang a request.
  let steps = 0;
  const MAX_STEPS = 200_000;

  function search(): boolean {
    if (remaining.length === 0) return true;
    if (++steps > MAX_STEPS) return false;

    // MRV: take the demand with the fewest currently-legal cells. Labs, being
    // the most constrained, naturally get placed first.
    let bestIdx = 0;
    let bestOptions: { day: DayOfWeek; startPeriod: number }[] = [];
    let bestCount = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const d = remaining[i];
      const legal = (candidates.get(d.key) ?? []).filter((c) => fits(d, c.day, c.startPeriod));
      if (legal.length < bestCount) {
        bestCount = legal.length;
        bestIdx = i;
        bestOptions = legal;
        if (bestCount === 0) break;   // dead end - fail fast
      }
    }

    if (bestCount === 0) return false;

    const d = remaining.splice(bestIdx, 1)[0];

    const ordered = shuffle(bestOptions, rnd).sort(
      (a, b) =>
        score(d, b.day, b.startPeriod, timing, rules, usedDaysBySubject) -
        score(d, a.day, a.startPeriod, timing, rules, usedDaysBySubject),
    );

    for (const opt of ordered) {
      if (!fits(d, opt.day, opt.startPeriod)) continue;
      apply(d, opt.day, opt.startPeriod);
      placements.push({ demand: d, day: opt.day, startPeriod: opt.startPeriod });
      if (search()) return true;
      placements.pop();
      undo(d, opt.day, opt.startPeriod);
    }

    remaining.splice(bestIdx, 0, d);
    return false;
  }

  return search() ? placements : null;
}

export function solve(input: SolveInput): SolveResult {
  const diagnostics: string[] = [];

  if (input.demands.length === 0) {
    return { ok: false, slots: null, diagnostics: ["No teaching assignments to schedule for this section."] };
  }

  // Randomised restarts: backtracking can wander into a bad region, and a fresh
  // ordering is far cheaper than exhausting the search space.
  const RESTARTS = 12;
  for (let attemptNo = 0; attemptNo < RESTARTS; attemptNo++) {
    const rnd = makeRng((input.seed ?? 0x9e3779b9) + attemptNo * 0x85ebca6b);
    const placements = attempt(input, rnd);
    if (placements) {
      const slots: DraftSlot[] = [];
      for (const p of placements) {
        for (let i = 0; i < p.demand.blockSize; i++) {
          slots.push({
            assignmentId: p.demand.assignmentId,
            facultyId: p.demand.facultyId,
            facultyName: p.demand.facultyName,
            subjectId: p.demand.subjectId,
            subjectName: p.demand.subjectName,
            subjectType: p.demand.subjectType,
            day: p.day,
            periodNumber: p.startPeriod + i,
            isBlockContinuation: i > 0,
          });
        }
      }
      slots.sort((a, b) =>
        a.day === b.day ? a.periodNumber - b.periodNumber : a.day.localeCompare(b.day),
      );
      if (attemptNo > 0) {
        diagnostics.push(`Solved after ${attemptNo + 1} attempts.`);
      }
      return { ok: true, slots, diagnostics };
    }
  }

  return { ok: false, slots: null, diagnostics: explainFailure(input) };
}

/**
 * Best-effort account of WHY nothing fit. A bare "generation failed" leaves the
 * HOD with nowhere to go, so name the specific demand and the specific blocker.
 */
function explainFailure(input: SolveInput): string[] {
  const { timing, rules, demands, pinnedCells, busyFaculty } = input;
  const out: string[] = [];

  const capacity = rules.workingDays.length * timing.numberOfPeriods - pinnedCells.size;
  const required = demands.reduce((s, d) => s + d.blockSize, 0);
  if (required > capacity) {
    out.push(
      `Not enough periods: ${required} needed but only ${capacity} free ` +
        `(${rules.workingDays.length} days x ${timing.numberOfPeriods} periods, minus ${pinnedCells.size} pinned).`,
    );
  }

  for (const d of demands) {
    const cells = candidateCells(d, timing, rules);
    if (cells.length === 0) {
      out.push(
        `${d.subjectName} needs ${d.blockSize} continuous period(s), which do not fit in a ` +
          `${timing.numberOfPeriods}-period day without crossing a break.`,
      );
      continue;
    }
    const fUsed = busyFaculty.get(d.facultyId);
    if (!fUsed) continue;
    const free = cells.filter((c) => {
      for (let p = c.startPeriod; p < c.startPeriod + d.blockSize; p++) {
        if (pinnedCells.has(cell(c.day, p)) || fUsed.has(cell(c.day, p))) return false;
      }
      return true;
    });
    if (free.length === 0) {
      out.push(
        `${d.subjectName}: ${d.facultyName} is already booked (in another section or a pinned slot) ` +
          `at every period where this could go.`,
      );
    }
  }

  // Per-faculty daily capacity across the week.
  const perFaculty = new Map<string, { name: string; periods: number }>();
  for (const d of demands) {
    const e = perFaculty.get(d.facultyId) ?? { name: d.facultyName, periods: 0 };
    e.periods += d.blockSize;
    perFaculty.set(d.facultyId, e);
  }
  for (const [, e] of perFaculty) {
    const max = rules.maxPeriodsPerFacultyPerDay * rules.workingDays.length;
    if (e.periods > max) {
      out.push(
        `${e.name} needs ${e.periods} periods in this section but the daily cap ` +
          `(${rules.maxPeriodsPerFacultyPerDay}/day x ${rules.workingDays.length} days) allows only ${max}.`,
      );
    }
  }

  if (out.length === 0) {
    out.push(
      "No valid arrangement found within the search limit. Try relaxing the per-day or " +
        "consecutive-period caps, or unpinning some manually-placed slots.",
    );
  }
  return out;
}
