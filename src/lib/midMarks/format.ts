import type { QuestionSheet, SheetColumn, SheetPart } from "@/lib/exams/questionMarks";
import type { MidFormatChoice, MidFormatComponent, MidFormatKind, MidSectionQuestion, MidSheetFormat } from "@/types/midMarks";

// Mid exam format (pure, browser + server). The Exam Cell sets what a Mid exam is made of per course + regulation
// (a subject may have its own list), e.g. VWU R26:
//   Descriptive  QUESTIONS  6 questions x 10, OR pairs (1 or 2, 3 or 4, 5 or 6)  -> 30
//   Quiz         ITEMS      20 items x 1, scaled                                  -> 10
//   Course Activity  MARK   one number                                            -> 10
// A section's paper fills in the QUESTIONS part: which questions have parts (Q2(A), Q2(B)) and the CO of each box.
// Everything here only builds / checks shapes; the marks rules live in lib/exams/questionMarks.ts.

export const FORMAT_KINDS: MidFormatKind[] = ["QUESTIONS", "ITEMS", "MARK"];
export const MAX_COMPONENTS = 6;
export const MAX_QUESTIONS = 20;
export const MAX_ITEMS = 100;
export const MAX_SUB_PARTS = 5;
export const PART_LETTERS = ["A", "B", "C", "D", "E"];

const isHalf = (n: number) => Number.isFinite(n) && Math.round(n * 2) === n * 2;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

/** How many questions count under the choice rule. */
export function answeredCount(questions: number, choice: MidFormatChoice): number {
  if (choice.kind === "OR_PAIRS") return Math.floor(questions / 2);
  if (choice.kind === "ANY") return Math.min(questions, choice.answer);
  return questions;
}

/** Checks the components of a format; returns them cleaned (ids P1, P2 ... in order, QUESTIONS max worked out). */
export function cleanComponents(raw: unknown): { components: MidFormatComponent[] } | { error: string } {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length === 0) return { error: "Add at least one component (for example Descriptive)." };
  if (list.length > MAX_COMPONENTS) return { error: `At most ${MAX_COMPONENTS} components.` };
  const out: MidFormatComponent[] = [];
  const names = new Set<string>();
  for (const [i, r0] of list.entries()) {
    const r = (r0 ?? {}) as Record<string, unknown>;
    const name = String(r.name ?? "").trim().replace(/\s+/g, " ");
    const at = name || `Component ${i + 1}`;
    if (!name || name.length > 40) return { error: `Component ${i + 1}: enter a name of up to 40 characters.` };
    if (names.has(name.toLowerCase())) return { error: `"${name}" is listed twice.` };
    names.add(name.toLowerCase());
    const kind = r.kind as MidFormatKind;
    if (!FORMAT_KINDS.includes(kind)) return { error: `${at}: choose how it is marked.` };
    const id = `P${i + 1}`;
    if (kind === "QUESTIONS") {
      const questions = num(r.questions), marksEach = num(r.marksEach);
      if (!Number.isInteger(questions) || questions < 1 || questions > MAX_QUESTIONS) return { error: `${at}: questions must be from 1 to ${MAX_QUESTIONS}.` };
      if (!(marksEach > 0) || marksEach > 100 || !isHalf(marksEach)) return { error: `${at}: marks per question must be from 0.5 to 100.` };
      const c = (r.choice ?? {}) as Record<string, unknown>;
      let choice: MidFormatChoice;
      if (c.kind === "OR_PAIRS") {
        if (questions % 2 === 1) return { error: `${at}: OR pairs need an even number of questions.` };
        choice = { kind: "OR_PAIRS" };
      } else if (c.kind === "ANY") {
        const answer = num(c.answer);
        if (!Number.isInteger(answer) || answer < 1 || answer >= questions) return { error: `${at}: "answer any" must be from 1 to ${questions - 1}.` };
        choice = { kind: "ANY", answer };
      } else choice = { kind: "ALL" };
      out.push({ id, name, kind, questions, marksEach, choice, max: answeredCount(questions, choice) * marksEach });
    } else if (kind === "ITEMS") {
      const items = num(r.items), itemMarks = num(r.itemMarks), max = num(r.max);
      if (!Number.isInteger(items) || items < 1 || items > MAX_ITEMS) return { error: `${at}: items must be from 1 to ${MAX_ITEMS}.` };
      if (!(itemMarks > 0) || itemMarks > 100 || !isHalf(itemMarks)) return { error: `${at}: marks per item must be from 0.5 to 100.` };
      if (!(max > 0) || max > 100 || !isHalf(max)) return { error: `${at}: "counts for" must be from 0.5 to 100.` };
      out.push({ id, name, kind, items, itemMarks, max });
    } else {
      const max = num(r.max);
      if (!(max > 0) || max > 100 || !isHalf(max)) return { error: `${at}: max marks must be from 0.5 to 100.` };
      out.push({ id, name, kind, max });
    }
  }
  return { components: out };
}

export const formatMax = (components: MidFormatComponent[]) => components.reduce((n, c) => n + c.max, 0);

/** "Descriptive 30 + Quiz 10 + Course Activity 10 = 50". */
export function formatLine(components: MidFormatComponent[]): string {
  return `${components.map((c) => `${c.name} ${c.max}`).join(" + ")} = ${formatMax(components)}`;
}

/** Same components (ids, kinds and sizes) - a sheet built on one fits the other. */
export function sameComponents(a: MidFormatComponent[], b: MidFormatComponent[]): boolean {
  const key = (c: MidFormatComponent) => [c.id, c.kind, c.max, c.questions ?? "", c.marksEach ?? "", JSON.stringify(c.choice ?? null), c.items ?? "", c.itemMarks ?? ""].join("|");
  return a.length === b.length && a.every((c, i) => key(c) === key(b[i]));
}

/** The plain list of questions 1..n without parts and without COs - a starting point. */
export function plainQuestions(component: MidFormatComponent): MidSectionQuestion[] {
  return Array.from({ length: component.questions ?? 0 }, (_, i) => ({ no: i + 1, parts: [], cos: [null] }));
}

/** Checks a section's questions for a QUESTIONS component: questions 1..n in order, parts A, B ... (2-5), a CO (or
 *  nothing) per box. */
export function cleanSectionQuestions(component: MidFormatComponent, raw: unknown): { questions: MidSectionQuestion[] } | { error: string } {
  const list = Array.isArray(raw) ? raw : [];
  const n = component.questions ?? 0;
  if (list.length !== n) return { error: `${component.name}: the format has ${n} questions.` };
  const out: MidSectionQuestion[] = [];
  for (const [i, r0] of list.entries()) {
    const r = (r0 ?? {}) as Record<string, unknown>;
    const partsRaw = Array.isArray(r.parts) ? r.parts.map((p) => String(p).trim().toUpperCase()) : [];
    if (partsRaw.length === 1 || partsRaw.length > MAX_SUB_PARTS) return { error: `${component.name} Q${i + 1}: a question has no parts, or 2 to ${MAX_SUB_PARTS} parts.` };
    if (partsRaw.some((p, j) => p !== PART_LETTERS[j])) return { error: `${component.name} Q${i + 1}: parts go A, B, C ... in order.` };
    const boxes = Math.max(1, partsRaw.length);
    const cosRaw = Array.isArray(r.cos) ? r.cos : [];
    const cos = Array.from({ length: boxes }, (_, j) => {
      const v = cosRaw[j];
      const s = typeof v === "string" ? v.trim().toUpperCase().replace(/\s+/g, "") : "";
      return s && /^[A-Z0-9.-]{1,10}$/.test(s) ? s : null;
    });
    out.push({ no: i + 1, parts: partsRaw, cos });
  }
  return { questions: out };
}

/** The questions with the same shape (numbers and parts) - only then can marks entered on one stay on the other. */
export function sameQuestionShape(a: MidSectionQuestion[] | undefined, b: MidSectionQuestion[] | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((q, i) => q.no === b[i].no && q.parts.join() === b[i].parts.join());
}

/** Column labels as on the paper: "Q2(A)" for a part, "Q3" for a question without parts. */
export const boxLabel = (no: number, part?: string) => (part ? `Q${no}(${part})` : `Q${no}`);
const boxKey = (componentId: string, no: number, part?: string) => `${componentId}q${no}${part ?? ""}`;

/** The marks sheet of a format + a section's questions (every QUESTIONS component needs its questions). */
export function sheetFromFormat(format: MidSheetFormat): QuestionSheet {
  const parts: SheetPart[] = [];
  const columns: SheetColumn[] = [];
  for (const c of format.components) {
    if (c.kind === "QUESTIONS") {
      const qs = format.questions[c.id] ?? plainQuestions(c);
      const cols = qs.flatMap((q) => (q.parts.length ? q.parts : [undefined]).map((p, j) => ({
        key: boxKey(c.id, q.no, p), label: boxLabel(q.no, p), max: c.marksEach ?? 0, partId: c.id, ...(q.cos[j] ? { co: q.cos[j]! } : {}),
      })));
      columns.push(...cols);
      parts.push({
        id: c.id, label: c.name, perQuestion: true, questions: qs.length, marksEach: c.marksEach ?? 0, choice: c.choice ?? { kind: "ALL" }, max: c.max,
        keys: cols.map((x) => x.key), groups: qs.map((q) => Math.max(1, q.parts.length)), groupMax: c.marksEach ?? 0,
      });
    } else if (c.kind === "ITEMS") {
      const cols = Array.from({ length: c.items ?? 0 }, (_, i) => ({ key: `${c.id}i${i + 1}`, label: `Q${i + 1}`, max: c.itemMarks ?? 1, partId: c.id }));
      columns.push(...cols);
      parts.push({
        id: c.id, label: c.name, perQuestion: true, questions: cols.length, marksEach: c.itemMarks ?? 1, choice: { kind: "ALL" }, max: c.max,
        keys: cols.map((x) => x.key), items: { count: cols.length, each: c.itemMarks ?? 1, scaleTo: c.max },
      });
    } else {
      columns.push({ key: c.id, label: c.name, max: c.max, partId: c.id });
      parts.push({ id: c.id, label: c.name, perQuestion: false, questions: 1, marksEach: c.max, choice: { kind: "ALL" }, max: c.max });
    }
  }
  return { paperMax: formatMax(format.components), parts, columns, source: "FORMAT" };
}

/** Boxes of written questions with no CO yet ("CO pending"). Marks are never held up by it. */
export function coPendingCount(format: MidSheetFormat | undefined): number {
  if (!format) return 0;
  return format.components.filter((c) => c.kind === "QUESTIONS")
    .reduce((n, c) => n + (format.questions[c.id] ?? plainQuestions(c)).reduce((m, q) => m + q.cos.filter((x) => !x).length, 0), 0);
}

/**
 * The questions of an uploaded Descriptive sheet from its column headings: "Q1", "Q2(A)", "Q2(B)", "2a", "Q3 (c)".
 * Questions must be 1..n in order, each once; parts A, B ... in order.
 */
export function questionsFromHeaders(labels: string[]): { questions: MidSectionQuestion[] } | { error: string } {
  const byNo = new Map<number, string[]>();
  const plain = new Set<number>();
  const order: number[] = [];
  for (const l of labels) {
    const m = l.trim().toUpperCase().replace(/\s+/g, "").match(/^Q?(\d{1,2})(?:\(?([A-E])\)?)?$/);
    if (!m) return { error: `"${l}" isn't a question heading (Q1, Q2(A) ...).` };
    const no = Number(m[1]);
    if (!byNo.has(no)) { byNo.set(no, []); order.push(no); } else if (order[order.length - 1] !== no) return { error: `Q${no}'s columns must be next to each other.` };
    const parts = byNo.get(no)!;
    if (plain.has(no)) return { error: `Q${no} is there twice.` };
    if (m[2]) {
      if (parts.includes(m[2])) return { error: `${l} is there twice.` };
      parts.push(m[2]);
    } else {
      if (parts.length) return { error: `Q${no} has a column with parts and one without.` };
      plain.add(no);
    }
  }
  const questions: MidSectionQuestion[] = [];
  for (const [i, no] of order.entries()) {
    if (no !== i + 1) return { error: `Questions must go Q1, Q2 ... in order (found Q${no} as question ${i + 1}).` };
    const parts = byNo.get(no)!;
    if (parts.length === 1) return { error: `Q${no} has only part (${parts[0]}) - a question has no parts or at least two.` };
    if (parts.some((p, j) => p !== PART_LETTERS[j])) return { error: `Q${no}'s parts must go (A), (B) ... in order.` };
    questions.push({ no, parts, cos: Array.from({ length: Math.max(1, parts.length) }, () => null) });
  }
  return { questions };
}

/** Keeps the COs of `prev` where the shape is the same (an upload of the same paper keeps the COs set earlier). */
export function keepCos(next: MidSectionQuestion[], prev: MidSectionQuestion[] | undefined): MidSectionQuestion[] {
  if (!prev || !sameQuestionShape(next, prev)) return next;
  return next.map((q, i) => ({ ...q, cos: q.cos.map((c, j) => c ?? prev[i].cos[j] ?? null) }));
}
