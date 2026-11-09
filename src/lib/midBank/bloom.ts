import type { BloomLevel } from "@/types/midQuestionBank";

// The Bloom's levels a college uses on Mid questions (Exam Cell > Mid Configuration, one list for the whole college,
// `examSettings/mid.bloomLevels`): which of the standard six, each one's name, and - for question bank colleges - how
// many questions of each a unit needs before it is complete. A bank / paper set keeps the list it started with
// (`bank.bloomLevels`), so a later change never breaks work in progress. Pure.

export interface BloomLevelDef {
  id: BloomLevel;
  name: string;
  /** Question bank: each unit needs at least this many parts at this level (0 = no minimum). */
  min: number;
}

/** The standard six, in order (the ids and their usual names). */
export const STANDARD_BLOOM: { id: BloomLevel; name: string }[] = [
  { id: "L1", name: "Remember" },
  { id: "L2", name: "Understand" },
  { id: "L3", name: "Apply" },
  { id: "L4", name: "Analyse" },
  { id: "L5", name: "Evaluate" },
  { id: "L6", name: "Create" },
];
export const BLOOM_IDS: BloomLevel[] = STANDARD_BLOOM.map((b) => b.id);

/** What every college used before the levels were configurable (and still uses until the Exam Cell edits them). */
export const DEFAULT_BLOOM_LEVELS: BloomLevelDef[] = [
  { id: "L2", name: "Understand", min: 3 },
  { id: "L3", name: "Apply", min: 3 },
  { id: "L4", name: "Analyse", min: 3 },
];

export const BLOOM_NAME_MAX = 40;
export const BLOOM_MIN_MAX = 10;

/** A saved list as read: kept in L1..L6 order, unknown / repeated ids dropped; missing or empty = the default. */
export function bloomLevelsOf(raw: unknown): BloomLevelDef[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_BLOOM_LEVELS;
  const seen = new Set<string>();
  const out: BloomLevelDef[] = [];
  for (const id of BLOOM_IDS) {
    const r = (raw as { id?: unknown; name?: unknown; min?: unknown }[]).find((x) => x?.id === id);
    if (!r || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: String(r.name ?? "").trim() || STANDARD_BLOOM.find((s) => s.id === id)!.name, min: Math.max(0, Math.min(BLOOM_MIN_MAX, Math.floor(Number(r.min) || 0))) });
  }
  return out.length ? out : DEFAULT_BLOOM_LEVELS;
}

/** The Exam Cell's edit: at least one level, names 1-40 characters, minimums 0-10, a unit's minimums at most 10 in all. */
export function cleanBloomLevels(raw: unknown): { value: BloomLevelDef[]; errors: string[] } {
  const errors: string[] = [];
  const list = Array.isArray(raw) ? (raw as { id?: unknown; name?: unknown; min?: unknown }[]) : [];
  const value: BloomLevelDef[] = [];
  for (const id of BLOOM_IDS) {
    const r = list.find((x) => x?.id === id);
    if (!r) continue;
    const name = String(r.name ?? "").replace(/\s+/g, " ").trim();
    const min = Number(r.min ?? 0);
    if (!name) errors.push(`${id} needs a name`);
    if (name.length > BLOOM_NAME_MAX) errors.push(`${id}: name up to ${BLOOM_NAME_MAX} characters`);
    if (!Number.isInteger(min) || min < 0 || min > BLOOM_MIN_MAX) errors.push(`${id}: the minimum per unit must be 0 to ${BLOOM_MIN_MAX}`);
    value.push({ id, name: name.slice(0, BLOOM_NAME_MAX), min: Number.isInteger(min) ? Math.max(0, Math.min(BLOOM_MIN_MAX, min)) : 0 });
  }
  if (value.length === 0) errors.push("Pick at least one Bloom's level");
  // A unit has 10 questions: minimums that add up to more could never be met.
  if (value.reduce((n, l) => n + l.min, 0) > 10) errors.push("The minimums add up to more than the 10 questions of a unit");
  return { value, errors };
}

export const isBloomLevel = (levels: BloomLevelDef[], x: unknown): x is BloomLevel => levels.some((l) => l.id === x);

/** "L3 - Apply". */
export const bloomLabel = (l: Pick<BloomLevelDef, "id" | "name">) => `${l.id} - ${l.name}`;
