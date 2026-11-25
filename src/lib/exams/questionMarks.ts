import type { MidPaperPattern, MidPaperQuestion, PaperChoice } from "@/types";
import { flexibleQuestions, marksPerQuestion } from "@/lib/midPapers/pattern";

// Marks of a component that comes from a Mid question paper (pure): the columns the faculty fill in (one total per
// objective part; each question of a short / descriptive part), the part totals under the paper's choice rule
// (OR pairs: the better of each pair; "any k": the best k; else all), and the component's marks - the paper total
// scaled to the component's maximum when they differ (nearest whole mark, half up).

export interface SheetColumn {
  key: string; label: string; max: number; partId: string;
  /** Format sheets: the CO this box is mapped to (none = CO pending). */
  co?: string;
}
export interface SheetPart {
  id: string; label: string; perQuestion: boolean; questions: number; marksEach: number; choice: PaperChoice; max: number;
  /** A faculty-decides part: each question's own max, in order (its columns are `${id}${no}`). */
  questionMax?: number[];
  /** A per-unit part: what it counts for - its raw total (`max`) scales to this. */
  countAs?: number;
  /** A faculty-decides part answered in full: its objective questions entered as one total (column `${id}obj`). */
  objectiveTotal?: { max: number; nos: number[] };
  /** Format sheets: the part's column keys in order (used instead of `${id}${n}`). */
  keys?: string[];
  /** Format sheets, QUESTIONS: boxes per question in order (Q2(A) + Q2(B) = 2) - added up into the question before
   *  the choice rule; a question adds up to at most `groupMax`. */
  groups?: number[];
  groupMax?: number;
  /** Format sheets, ITEMS: `count` items of `each` marks, added up and scaled to `scaleTo` (nearest, half up). */
  items?: { count: number; each: number; scaleTo: number };
}
export interface QuestionSheet {
  paperMax: number; parts: SheetPart[]; columns: SheetColumn[];
  /** CHOSEN: the Exam Cell's paper; PATTERN: the course pattern; LAYOUT: questions + max marks the Exam Cell set (midMarksEntry.ts);
   *  FORMAT: the college's Mid exam format + the section's questions (lib/midMarks/format.ts). */
  source: "CHOSEN" | "PATTERN" | "LAYOUT" | "FORMAT";
  /** The finalized (printed) paper this sheet comes from - the faculty can view it once the exam date has come. */
  paper?: { choiceId: string; date: string };
}

/**
 * The sheet for a paper. A faculty-decides part is laid out from that paper's own questions (`set` of `questions`):
 * answered in full, its objective questions are one total and short / descriptive ones each a column; with OR pairs
 * or "any k", every question is a column. Without the paper's questions such a part can't be laid out (null).
 */
export function sheetFromPattern(pattern: Pick<MidPaperPattern, "parts">, source: QuestionSheet["source"], paper?: { set: number; questions: Pick<MidPaperQuestion, "set" | "partId" | "no" | "kind" | "marks">[] }): QuestionSheet | null {
  if (pattern.parts.some((p) => p.flexible) && !paper) return null;
  // A per-unit part not yet laid out for a paper (no questions) can't be entered question by question.
  if (pattern.parts.some((p) => !p.flexible && p.perUnit && !p.questions)) return null;
  const parts: SheetPart[] = pattern.parts.map((p) => {
    if (p.flexible) {
      const qs = flexibleQuestions(paper!.questions, paper!.set, p.id);
      const questionMax = qs.map((q) => q.marks ?? 0);
      const objective = p.choice.kind === "ALL" ? qs.filter((q) => q.kind === "MCQ" || q.kind === "FILL_BLANK") : [];
      return {
        id: p.id, label: p.label, perQuestion: true, questions: qs.length, marksEach: 0, choice: p.choice, max: p.maxMarks ?? 0, questionMax,
        ...(objective.length ? { objectiveTotal: { max: objective.reduce((n, q) => n + (q.marks ?? 0), 0), nos: objective.map((q) => q.no) } } : {}),
      };
    }
    const answered = p.choice.kind === "ANY" ? Math.min(p.questions, p.choice.answer) : p.choice.kind === "OR_PAIRS" ? Math.floor(p.questions / 2) : p.questions;
    return {
      id: p.id, label: p.label, perQuestion: marksPerQuestion(p.kind), questions: p.questions, marksEach: p.marksEach, choice: p.choice, max: answered * p.marksEach,
      ...(p.perUnit && p.maxMarks ? { countAs: p.maxMarks } : {}),
    };
  });
  const columns: SheetColumn[] = parts.flatMap((p) => {
    if (p.questionMax) {
      const objNos = new Set(p.objectiveTotal?.nos ?? []);
      return [
        ...(p.objectiveTotal ? [{ key: `${p.id}obj`, label: `${p.id} objective`, max: p.objectiveTotal.max, partId: p.id }] : []),
        ...p.questionMax.map((max, i) => ({ key: `${p.id}${i + 1}`, label: p.id === "CEA" ? `Q${i + 1}` : `${p.id}${i + 1}`, max, partId: p.id })).filter((_, i) => !objNos.has(i + 1)),
      ];
    }
    return p.perQuestion
      ? Array.from({ length: p.questions }, (_, i) => ({ key: `${p.id}${i + 1}`, label: `${p.id}${i + 1}`, max: p.marksEach, partId: p.id }))
      : [{ key: p.id, label: `${p.label} (total)`, max: p.max, partId: p.id }];
  });
  // What the paper counts for: a per-unit part its own max, every other part its real max.
  return { paperMax: parts.reduce((n, p) => n + (p.countAs ?? p.max), 0), parts, columns, source };
}

type Values = Record<string, number | null | undefined>;

/** The choice rule over question marks in order: OR pairs = the better of each pair, any k = the best k, else all. */
function underChoice(choice: PaperChoice, n: number[]): number {
  if (choice.kind === "OR_PAIRS") {
    let sum = 0;
    for (let i = 0; i < n.length; i += 2) sum += Math.max(n[i], n[i + 1] ?? 0);
    return sum;
  }
  if (choice.kind === "ANY") return [...n].sort((a, b) => b - a).slice(0, choice.answer).reduce((a, b) => a + b, 0);
  return n.reduce((a, b) => a + b, 0);
}

/** Boxes per question added up (format sheets: Q2(A) + Q2(B)). */
export function groupSums(part: Pick<SheetPart, "groups">, boxes: number[]): number[] {
  if (!part.groups) return boxes;
  const out: number[] = [];
  let i = 0;
  for (const g of part.groups) { out.push(boxes.slice(i, i + g).reduce((a, b) => a + b, 0)); i += g; }
  return out;
}

/** A part's marks from what was entered (blank question = not answered). */
export function partTotal(part: SheetPart, values: Values): number | null {
  if (part.keys) {
    const raw = part.keys.map((k) => values[k] ?? null);
    if (raw.every((v) => v == null)) return null;
    const n = raw.map((v) => v ?? 0);
    if (part.items) {
      const full = part.items.count * part.items.each;
      return full > 0 ? Math.floor((n.reduce((a, b) => a + b, 0) * part.items.scaleTo) / full + 0.5) : 0;
    }
    return underChoice(part.choice, groupSums(part, n));
  }
  if (!part.perQuestion) { const v = values[part.id]; return v == null ? null : v; }
  const objNos = new Set(part.objectiveTotal?.nos ?? []);
  const q = Array.from({ length: part.questions }, (_, i) => (objNos.has(i + 1) ? null : values[`${part.id}${i + 1}`] ?? null));
  const obj = part.objectiveTotal ? values[`${part.id}obj`] ?? null : null;
  if (q.every((v) => v == null) && obj == null) return null;
  const n = q.map((v) => v ?? 0);
  if (part.objectiveTotal) return (obj ?? 0) + n.reduce((a, b) => a + b, 0);
  // An odd last question of OR pairs never counted here (pairs only) - kept as it was.
  if (part.choice.kind === "OR_PAIRS" && n.length % 2 === 1) return underChoice(part.choice, n.slice(0, -1));
  return underChoice(part.choice, n);
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
    // A per-unit part scales to what it counts for (6 units x 5 = 30 -> 25); rounding happens once, at the end.
    sum += p.countAs && p.max > 0 ? (t * p.countAs) / p.max : t;
  }
  return sum;
}

/** The component's marks: the paper total scaled to the component's max, rounded once (nearest whole mark, half up). */
export function scaleToComponent(total: number, paperMax: number, componentMax: number): number {
  const v = paperMax === componentMax || paperMax <= 0 ? total : (total * componentMax) / paperMax;
  // Unscaled whole / half marks stay as entered; anything worked out is rounded.
  return Number.isInteger(v * 2) && paperMax === componentMax ? v : Math.floor(v + 0.5);
}

/** The first value that doesn't fit its column (above its max, negative, not a number), or null. */
export function questionMarksError(sheet: QuestionSheet, values: Values): string | null {
  for (const c of sheet.columns) {
    const v = values[c.key];
    if (v == null) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > c.max) return `${c.label} must be between 0 and ${c.max}`;
    if (Math.round(v * 2) !== v * 2) return `${c.label}: marks in halves only`;
  }
  const g = groupError(sheet, values);
  if (g) return g;
  // An Exam Cell layout has no choice rule: what was entered adds up, and can't go above the paper max.
  if (sheet.source === "LAYOUT") {
    const total = paperTotal(sheet, values);
    if (total != null && total > sheet.paperMax) return `the total (${total}) is above the paper max (${sheet.paperMax})`;
  }
  return null;
}

/** Format sheets: the first question whose parts add up to more than the question's marks (Q2(A) + Q2(B) > 10), or null. */
export function groupError(sheet: QuestionSheet, values: Values): string | null {
  for (const p of sheet.parts) {
    if (!p.groups || !p.keys || p.groupMax == null) continue;
    const cols = sheet.columns.filter((c) => c.partId === p.id);
    let i = 0;
    for (const g of p.groups) {
      const box = cols.slice(i, i + g);
      i += g;
      if (g < 2) continue;
      const sum = box.reduce((n, c) => n + (typeof values[c.key] === "number" ? (values[c.key] as number) : 0), 0);
      if (sum > p.groupMax) return `${box.map((c) => c.label).join(" + ")} add up to ${sum}, more than the question's ${p.groupMax}`;
    }
  }
  return null;
}

/** Only the sheet's keys, as numbers or null. */
export function cleanQuestionValues(sheet: QuestionSheet, raw: unknown): Record<string, number | null> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(sheet.columns.map((c) => [c.key, typeof r[c.key] === "number" ? (r[c.key] as number) : r[c.key] == null || r[c.key] === "" ? null : Number(r[c.key])]));
}
