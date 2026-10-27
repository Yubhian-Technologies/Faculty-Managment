import type { BloomLevel, MidQuestion, MidUnitStatus } from "@/types/midQuestionBank";
import { BLOOM_LEVELS, BLOOM_MIN_PER_UNIT, QUESTIONS_PER_UNIT } from "./constants";

// Unit progress of a bank. A unit is COMPLETE when all QUESTIONS_PER_UNIT
// slots hold a complete question AND every Bloom level L2/L3/L4 is used at
// least BLOOM_MIN_PER_UNIT times among those questions' parts. Units open in
// the Mid's order: a unit is writable once every unit before it is complete.

type Q = Pick<MidQuestion, "unit" | "state" | "parts">;

export function unitStatus(questions: Q[], unit: number): MidUnitStatus {
  const bloom: Record<BloomLevel, number> = { L2: 0, L3: 0, L4: 0 };
  let completeCount = 0, draftCount = 0;
  for (const q of questions) {
    if (q.unit !== unit) continue;
    if (q.state === "COMPLETE") {
      completeCount++;
      for (const p of q.parts) if (p.bloom) bloom[p.bloom]++;
    } else draftCount++;
  }
  const complete = completeCount >= QUESTIONS_PER_UNIT && BLOOM_LEVELS.every((l) => bloom[l] >= BLOOM_MIN_PER_UNIT);
  return { complete, completeCount, draftCount, bloom };
}

export function unitStatuses(units: number[], questions: Q[]): Record<string, MidUnitStatus> {
  return Object.fromEntries(units.map((u) => [String(u), unitStatus(questions, u)]));
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

/** Live Bloom tally lines: "L3: 2 - need 1 more". */
export function bloomNeeds(bloom: Record<BloomLevel, number>): { level: BloomLevel; count: number; need: number }[] {
  return BLOOM_LEVELS.map((level) => ({ level, count: bloom[level], need: Math.max(0, BLOOM_MIN_PER_UNIT - bloom[level]) }));
}

/**
 * A completed unit must stay complete: an edit that would turn it back (a
 * question made a draft, or a Bloom level falling below the minimum) is refused.
 */
export function breaksCompletedUnit(before: MidUnitStatus | undefined, after: MidUnitStatus): string {
  if (!before?.complete || after.complete) return "";
  if (after.completeCount < QUESTIONS_PER_UNIT) return "This unit is complete - a question in it can't go back to a draft";
  const short = bloomNeeds(after.bloom).filter((b) => b.need > 0).map((b) => `${b.level} would drop to ${b.count}`);
  return `This unit is complete and needs at least ${BLOOM_MIN_PER_UNIT} of each Bloom level - ${short.join(", ")}`;
}

export function bankTotals(units: number[], statuses: Record<string, MidUnitStatus>) {
  const totalCount = units.length * QUESTIONS_PER_UNIT;
  const completeCount = units.reduce((n, u) => n + Math.min(QUESTIONS_PER_UNIT, statuses[String(u)]?.completeCount ?? 0), 0);
  const allComplete = units.length > 0 && units.every((u) => statuses[String(u)]?.complete);
  return { totalCount, completeCount, allComplete };
}
