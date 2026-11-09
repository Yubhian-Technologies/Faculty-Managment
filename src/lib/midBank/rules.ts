import type { BloomLevel, MidQuestion, MidUnitStatus } from "@/types/midQuestionBank";
import type { MidOutcomeSwitches } from "@/types/examMidSchedule";
import { QUESTIONS_PER_UNIT } from "./constants";
import { ALL_OUTCOMES_ON } from "./outcomeSwitches";
import { DEFAULT_BLOOM_LEVELS, type BloomLevelDef } from "./bloom";

// Unit progress of a bank. A unit is COMPLETE when all QUESTIONS_PER_UNIT
// slots hold a complete question AND each of the college's Bloom's levels is used at least its minimum number of times
// among those questions' parts (the Exam Cell's list, kept on the bank - `bloom.ts`; only for a college that uses
// Bloom's levels). Units open in the Mid's order: a unit is writable once every unit before it is complete.

type Q = Pick<MidQuestion, "unit" | "state" | "parts">;

export function unitStatus(questions: Q[], unit: number, sw: MidOutcomeSwitches = ALL_OUTCOMES_ON, levels: BloomLevelDef[] = DEFAULT_BLOOM_LEVELS): MidUnitStatus {
  const bloom: Partial<Record<BloomLevel, number>> = Object.fromEntries(levels.map((l) => [l.id, 0]));
  let completeCount = 0, draftCount = 0;
  for (const q of questions) {
    if (q.unit !== unit) continue;
    if (q.state === "COMPLETE") {
      completeCount++;
      for (const p of q.parts) if (p.bloom) bloom[p.bloom] = (bloom[p.bloom] ?? 0) + 1;
    } else draftCount++;
  }
  const complete = completeCount >= QUESTIONS_PER_UNIT && (!sw.bloom || levels.every((l) => (bloom[l.id] ?? 0) >= l.min));
  return { complete, completeCount, draftCount, bloom };
}

export function unitStatuses(units: number[], questions: Q[], sw: MidOutcomeSwitches = ALL_OUTCOMES_ON, levels: BloomLevelDef[] = DEFAULT_BLOOM_LEVELS): Record<string, MidUnitStatus> {
  return Object.fromEntries(units.map((u) => [String(u), unitStatus(questions, u, sw, levels)]));
}

/** The units a faculty member may write in now: the first, and each one whose predecessors are all complete. */
export function unlockedUnits(units: number[], statuses: Record<string, MidUnitStatus>): Set<number> {
  const open = new Set<number>();
  for (const u of units) {
    open.add(u);
    if (!statuses[String(u)]?.complete) break;
  }
  return open;
}

/** Why a unit is locked ("" when it is open). */
export function lockReason(units: number[], statuses: Record<string, MidUnitStatus>, unit: number): string {
  if (unlockedUnits(units, statuses).has(unit)) return "";
  const blocking = units.find((u) => !statuses[String(u)]?.complete);
  return blocking !== undefined ? `Opens when Unit ${blocking} is complete` : "";
}

/** Live Bloom tally lines: "L3: 2 - need 1 more" (each of the college's levels against its minimum). */
export function bloomNeeds(bloom: Partial<Record<BloomLevel, number>>, levels: BloomLevelDef[] = DEFAULT_BLOOM_LEVELS): { level: BloomLevel; count: number; need: number; min: number }[] {
  return levels.map((l) => ({ level: l.id, count: bloom[l.id] ?? 0, min: l.min, need: Math.max(0, l.min - (bloom[l.id] ?? 0)) }));
}

/**
 * A completed unit must stay complete: an edit that would turn it back (a
 * question made a draft, or a Bloom level falling below the minimum) is refused.
 */
export function breaksCompletedUnit(before: MidUnitStatus | undefined, after: MidUnitStatus, levels: BloomLevelDef[] = DEFAULT_BLOOM_LEVELS): string {
  if (!before?.complete || after.complete) return "";
  if (after.completeCount < QUESTIONS_PER_UNIT) return "This unit is complete - a question in it can't go back to a draft";
  const short = bloomNeeds(after.bloom, levels).filter((b) => b.need > 0).map((b) => `${b.level} would drop to ${b.count} (needs ${b.min})`);
  return `This unit is complete and needs its Bloom's levels - ${short.join(", ")}`;
}

export function bankTotals(units: number[], statuses: Record<string, MidUnitStatus>) {
  const totalCount = units.length * QUESTIONS_PER_UNIT;
  const completeCount = units.reduce((n, u) => n + Math.min(QUESTIONS_PER_UNIT, statuses[String(u)]?.completeCount ?? 0), 0);
  const allComplete = units.length > 0 && units.every((u) => statuses[String(u)]?.complete);
  return { totalCount, completeCount, allComplete };
}
