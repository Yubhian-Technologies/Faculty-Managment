import type { BloomLevel, MidQuestion } from "@/types/midQuestionBank";
import { BLOOM_IDS } from "@/lib/midBank/bloom";

// Mid Question Paper rules (pure): the Exam Cell's template, and picking a
// paper's 6 questions from a complete question bank.

export const PAPER_QUESTIONS = 6;
export const PAPER_PAIRS = 3;
export const DEFAULT_INSTRUCTION = "Answer one question from each unit. All questions carry equal marks.";
export const DEFAULT_SEQUENCES: Partial<Record<BloomLevel, BloomLevel[]>> = {
  L2: ["L2", "L3", "L3", "L4", "L4", "L2"],
  L3: ["L3", "L3", "L4", "L4", "L2", "L2"],
  L4: ["L4", "L4", "L2", "L2", "L3", "L3"],
};
/** A start level's default sequence among the college's levels: the old default when it fits, else the levels in turn. */
export function defaultSequenceFor(start: BloomLevel, ids: BloomLevel[]): BloomLevel[] {
  const old = DEFAULT_SEQUENCES[start];
  if (old && old.every((l) => ids.includes(l))) return old;
  const from = Math.max(0, ids.indexOf(start));
  return Array.from({ length: PAPER_QUESTIONS }, (_, i) => ids[(from + i) % ids.length]);
}
/** Default unit of Questions 1-6 for a Mid of N units (positions, 1 = the Mid's first unit). */
export function defaultUnits(n: number): number[] {
  if (n === 2) return [1, 1, 2, 2, 1, 2];
  return Array.from({ length: PAPER_QUESTIONS }, (_, i) => Math.min(n, Math.floor((i * n) / PAPER_QUESTIONS) + 1));
}
export const UNIT_COUNTS = [1, 2, 3, 6];
/** Regd. No boxes on the paper: real numbers are 10-11 characters (VWU uses 11). */
export const DEFAULT_REGD_BOXES = 12;
export const REGD_BOXES_MIN = 6;
export const REGD_BOXES_MAX = 20;

const isLevel = (x: unknown): x is BloomLevel => BLOOM_IDS.includes(x as BloomLevel);

/**
 * The template sent by the settings form, checked. Every unit of a Mid must carry the same number of questions. `ids` =
 * the college's Bloom's levels (Exam Cell, `bloom.ts`): a sequence per start level, using only those levels.
 */
export function cleanTemplate(raw: { sequences?: unknown; units?: unknown; instruction?: unknown; maxMarks?: unknown; regdBoxes?: unknown }, ids: BloomLevel[] = ["L2", "L3", "L4"]) {
  const errors: string[] = [];
  const seqIn = (raw.sequences ?? {}) as Record<string, unknown>;
  const sequences = {} as Partial<Record<BloomLevel, BloomLevel[]>>;
  const ok = (x: unknown): x is BloomLevel => isLevel(x) && ids.includes(x);
  for (const start of ids) {
    const list = Array.isArray(seqIn[start]) ? (seqIn[start] as unknown[]) : [];
    if (list.length !== PAPER_QUESTIONS || !list.every(ok)) errors.push(`Starting at ${start}: pick a level for each of the ${PAPER_QUESTIONS} questions`);
    else if (list[0] !== start) errors.push(`Starting at ${start}: Question 1 must be ${start}`);
    sequences[start] = list.filter(ok);
  }
  const unitsIn = (raw.units ?? {}) as Record<string, unknown>;
  const units: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(unitsIn)) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1 || n > PAPER_QUESTIONS) continue;
    const list = Array.isArray(v) ? v.map(Number) : [];
    if (list.length !== PAPER_QUESTIONS || list.some((u) => !Number.isInteger(u) || u < 1 || u > n)) { errors.push(`${n}-unit Mid: pick a unit for each question`); continue; }
    const counts = Array.from({ length: n }, (_, i) => list.filter((u) => u === i + 1).length);
    if (counts.some((c) => c !== counts[0])) { errors.push(`${n}-unit Mid: every unit needs the same number of questions (now ${counts.join(" / ")})`); continue; }
    units[String(n)] = list;
  }
  if (Object.keys(units).length === 0) errors.push("Set the units of the questions for at least one Mid size");
  const instruction = String(raw.instruction ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || DEFAULT_INSTRUCTION;
  const m = raw.maxMarks === null || raw.maxMarks === "" || raw.maxMarks === undefined ? null : Number(raw.maxMarks);
  if (m !== null && (!Number.isInteger(m) || m < 1 || m > 500)) errors.push("Max marks must be a whole number");
  const boxes = raw.regdBoxes === undefined || raw.regdBoxes === "" || raw.regdBoxes === null ? DEFAULT_REGD_BOXES : Number(raw.regdBoxes);
  if (!Number.isInteger(boxes) || boxes < REGD_BOXES_MIN || boxes > REGD_BOXES_MAX) errors.push(`Regd. No boxes must be ${REGD_BOXES_MIN} to ${REGD_BOXES_MAX}`);
  return { value: { sequences, units, instruction, maxMarks: m, regdBoxes: boxes }, errors };
}

/** A question's level for the paper: the level all its parts share (mixed levels = none). */
export function questionLevel(q: Pick<MidQuestion, "parts">): BloomLevel | null {
  const levels = new Set(q.parts.map((p) => p.bloom));
  const only = [...levels][0];
  return levels.size === 1 && isLevel(only) ? only : null;
}

export interface PaperSlot { no: number; unit: number; level: BloomLevel }

/** What each of the 6 questions needs: the Mid's actual unit numbers and the level sequence for the chosen start. */
export function paperSlots(midUnits: number[], template: { sequences: Record<string, BloomLevel[]>; units: Record<string, number[]> }, start: BloomLevel): { slots: PaperSlot[]; error: string } {
  const seq = template.sequences[start];
  const pos = template.units[String(midUnits.length)];
  if (!seq || seq.length !== PAPER_QUESTIONS) return { slots: [], error: `The template has no level sequence starting at ${start}` };
  if (!pos) return { slots: [], error: `The template has no unit layout for a Mid of ${midUnits.length} unit${midUnits.length === 1 ? "" : "s"}` };
  return { slots: seq.map((level, i) => ({ no: i + 1, unit: midUnits[pos[i] - 1], level })), error: "" };
}

/**
 * Pick the paper: for each slot a different COMPLETE question of its unit and
 * level, at random. `candidates[no]` lists every question that could fill the
 * slot (for Swap). `shortages` says what a bank lacks (nothing picked then).
 */
export function pickPaper<Q extends Pick<MidQuestion, "id" | "unit" | "state" | "parts">>(
  questions: Q[], slots: PaperSlot[], random: () => number = Math.random,
  /** false = the college doesn't use Bloom's levels: any complete question of the slot's unit fits. */
  byLevel = true,
): { picked: Q[]; candidates: Record<number, Q[]>; shortages: string[] } {
  const usable = questions.filter((q) => q.state === "COMPLETE");
  const fits = (q: Q, unit: number, level: string) => q.unit === unit && (!byLevel || questionLevel(q) === level);
  const candidates: Record<number, Q[]> = {};
  for (const s of slots) candidates[s.no] = usable.filter((q) => fits(q, s.unit, s.level));
  const shortages: string[] = [];
  const need = new Map<string, number>();
  const keyOf = (s: PaperSlot) => (byLevel ? `${s.unit}|${s.level}` : `${s.unit}|`);
  for (const s of slots) need.set(keyOf(s), (need.get(keyOf(s)) ?? 0) + 1);
  for (const [k, n] of need) {
    const [unit, level] = k.split("|");
    const have = usable.filter((q) => fits(q, Number(unit), level)).length;
    if (have < n) shortages.push(byLevel
      ? `Unit ${unit} has ${have} complete ${level} question${have === 1 ? "" : "s"} with every part at ${level}; the paper needs ${n}`
      : `Unit ${unit} has ${have} complete question${have === 1 ? "" : "s"}; the paper needs ${n}`);
  }
  if (shortages.length) return { picked: [], candidates, shortages };
  const used = new Set<string>();
  const picked = slots.map((s) => {
    const pool = candidates[s.no].filter((q) => !used.has(q.id));
    const q = pool[Math.floor(random() * pool.length)];
    used.add(q.id);
    return q;
  });
  return { picked, candidates, shortages };
}
