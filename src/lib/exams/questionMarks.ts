import type { MidPaperPattern, PaperChoice } from "@/types";
import { marksPerQuestion, patternMax } from "@/lib/midPapers/pattern";

// Marks of a component that comes from a Mid question paper (pure): the columns the faculty fill in (one total per
// objective part; each question of a short / descriptive part), the part totals under the paper's choice rule
// (OR pairs: the better of each pair; "any k": the best k; else all), and the component's marks - the paper total
// scaled to the component's maximum when they differ (nearest whole mark, half up).

export interface SheetColumn { key: string; label: string; max: number; partId: string }
export interface SheetPart { id: string; label: string; perQuestion: boolean; questions: number; marksEach: number; choice: PaperChoice; max: number }
export interface QuestionSheet { paperMax: number; parts: SheetPart[]; columns: SheetColumn[]; source: "CHOSEN" | "PATTERN" }

export function sheetFromPattern(pattern: Pick<MidPaperPattern, "parts">, source: QuestionSheet["source"]): QuestionSheet {
  const parts: SheetPart[] = pattern.parts.map((p) => {
    const answered = p.choice.kind === "ANY" ? Math.min(p.questions, p.choice.answer) : p.choice.kind === "OR_PAIRS" ? Math.floor(p.questions / 2) : p.questions;
    return { id: p.id, label: p.label, perQuestion: marksPerQuestion(p.kind), questions: p.questions, marksEach: p.marksEach, choice: p.choice, max: answered * p.marksEach };
  });
  const columns: SheetColumn[] = parts.flatMap((p) => p.perQuestion
    ? Array.from({ length: p.questions }, (_, i) => ({ key: `${p.id}${i + 1}`, label: `${p.id}${i + 1}`, max: p.marksEach, partId: p.id }))
    : [{ key: p.id, label: `${p.label} (total)`, max: p.max, partId: p.id }]);
  return { paperMax: patternMax(pattern), parts, columns, source };
}

type Values = Record<string, number | null | undefined>;

/** A part's marks from what was entered (blank question = not answered). */
export function partTotal(part: SheetPart, values: Values): number | null {
  if (!part.perQuestion) { const v = values[part.id]; return v == null ? null : v; }
  const q = Array.from({ length: part.questions }, (_, i) => values[`${part.id}${i + 1}`] ?? null);
  if (q.every((v) => v == null)) return null;
  const n = q.map((v) => v ?? 0);
  if (part.choice.kind === "OR_PAIRS") {
    let sum = 0;
    for (let i = 0; i + 1 < n.length; i += 2) sum += Math.max(n[i], n[i + 1]);
    return sum;
  }
  if (part.choice.kind === "ANY") return [...n].sort((a, b) => b - a).slice(0, part.choice.answer).reduce((a, b) => a + b, 0);
  return n.reduce((a, b) => a + b, 0);
}

/**
 * The paper total, or null while it isn't entered: every objective part needs its total, and at least one question
 * of each short / descriptive part (an absent student: enter 0).
 */
export function paperTotal(sheet: QuestionSheet, values: Values): number | null {
  let sum = 0;
  for (const p of sheet.parts) {
    const t = partTotal(p, values);
    if (t == null) return null;
    sum += t;
  }
  return sum;
}

export const scaleToComponent = (total: number, paperMax: number, componentMax: number) =>
  paperMax === componentMax || paperMax <= 0 ? total : Math.floor((total * componentMax) / paperMax + 0.5);

/** The first value that doesn't fit its column (above its max, negative, not a number), or null. */
export function questionMarksError(sheet: QuestionSheet, values: Values): string | null {
  for (const c of sheet.columns) {
    const v = values[c.key];
    if (v == null) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > c.max) return `${c.label} must be between 0 and ${c.max}`;
    if (Math.round(v * 2) !== v * 2) return `${c.label}: marks in halves only`;
  }
  return null;
}

/** Only the sheet's keys, as numbers or null. */
export function cleanQuestionValues(sheet: QuestionSheet, raw: unknown): Record<string, number | null> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(sheet.columns.map((c) => [c.key, typeof r[c.key] === "number" ? (r[c.key] as number) : r[c.key] == null || r[c.key] === "" ? null : Number(r[c.key])]));
}
