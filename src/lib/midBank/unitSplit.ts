import { LIMITS } from "./constants";

// Which units a Mid covers for one subject: the Exam Cell's exception for that
// subject, else the course rule's split for the subject's number of units, else
// the course rule's default. Pure - shared by the setup check, the bank start
// and the settings screens.

/** Unit counts the settings offer a split for. */
export const SPLIT_UNIT_COUNTS = [3, 4, 5, 6, 7, 8];

/** A sensible first split for N units over two Mids (an odd count shares its middle unit). */
export function suggestedSplit(n: number): Record<string, number[]> {
  const half = Math.ceil(n / 2);
  return { "1": Array.from({ length: half }, (_, i) => i + 1), "2": Array.from({ length: n - half + (n % 2) }, (_, i) => half - (n % 2) + i + 1) };
}

type MidMap = Record<string, number[]>;

/** A Mid -> units map as sent by a form: Mid numbers 1-9, units 1..max, no repeats; empty Mids dropped. */
export function cleanMidMap(raw: unknown, max: number = LIMITS.units): { value: MidMap; error: string } {
  const value: MidMap = {};
  for (const [mid, list] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (!/^[1-9]$/.test(mid) || !Array.isArray(list)) continue;
    const units = [...new Set(list.map(Number))];
    if (units.length === 0) continue;
    if (units.some((u) => !Number.isInteger(u) || u < 1 || u > max)) return { value: {}, error: `Mid ${mid}: units must be numbers from 1 to ${max}` };
    value[mid] = units;
  }
  return { value, error: "" };
}

/**
 * The units Mid `midNumber` covers for a subject: its exception, else the split
 * for its unit count (when known), else the rule's default. `source` says which.
 */
export function midUnitsFor(
  rules: { mids: MidMap; unitSplits?: Record<string, MidMap> } | null,
  midNumber: number,
  unitCount: number | null,
  exception?: MidMap | null,
): { units: number[]; source: "SUBJECT" | "UNIT_COUNT" | "DEFAULT" | "NONE" } {
  const mid = String(midNumber);
  if (exception?.[mid]?.length) return { units: exception[mid], source: "SUBJECT" };
  if (!rules) return { units: [], source: "NONE" };
  const byCount = unitCount ? rules.unitSplits?.[String(unitCount)]?.[mid] : undefined;
  if (byCount?.length) return { units: byCount, source: "UNIT_COUNT" };
  return { units: rules.mids[mid] ?? [], source: rules.mids[mid]?.length ? "DEFAULT" : "NONE" };
}
