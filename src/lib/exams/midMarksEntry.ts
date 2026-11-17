import type { QuestionSheet, SheetColumn, SheetPart } from "@/lib/exams/questionMarks";

// Who enters a Mid's marks, and the question layout the Exam Cell sets (pure).
//
// Per course + Mid (colleges/{c}/midMarksEntry/{courseKey}__m{mid}): FACULTY (default - each subject's faculty
// enters question-wise for their section) or EXAM_CELL (the Exam Cell uploads; faculty only view).
// The question columns of a Mid's marks are, in order of preference:
//   1. the paper the Exam Cell FINALIZED (printed) for the subject + branch - exactly what the students wrote;
//   2. else the Exam Cell's own layout for that subject + branch + Mid (colleges/{c}/midMarksLayouts/...):
//      question labels + max marks + the paper max - set on Question Layout, or in the upload sheet's header;
//   3. else none: faculty entry for that Mid isn't open yet (never typed as one number any more).

export type MidMarksMode = "FACULTY" | "EXAM_CELL";
export const MID_MARKS_MODES: MidMarksMode[] = ["FACULTY", "EXAM_CELL"];

export interface MidLayoutQuestion { label: string; max: number }
export interface MidMarksLayout { questions: MidLayoutQuestion[]; paperMax: number }

export const MAX_LAYOUT_QUESTIONS = 40;
const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9 ()._-]{0,11}$/;

const isHalf = (n: number) => Number.isFinite(n) && Math.round(n * 2) === n * 2;

/** Checks an Exam Cell layout; returns it cleaned, or the first problem. */
export function cleanLayout(raw: unknown): { layout: MidMarksLayout } | { error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as { questions?: unknown; paperMax?: unknown };
  const qs = Array.isArray(r.questions) ? r.questions : [];
  if (qs.length === 0) return { error: "Add at least one question." };
  if (qs.length > MAX_LAYOUT_QUESTIONS) return { error: `At most ${MAX_LAYOUT_QUESTIONS} questions.` };
  const questions: MidLayoutQuestion[] = [];
  const seen = new Set<string>();
  for (const [i, q] of qs.entries()) {
    const label = String((q as { label?: unknown })?.label ?? "").trim();
    const max = Number((q as { max?: unknown })?.max);
    if (!LABEL_RE.test(label)) return { error: `Question ${i + 1}: enter a short name (up to 12 letters / numbers, e.g. Q1 or 2a).` };
    if (seen.has(label.toUpperCase())) return { error: `"${label}" is listed twice.` };
    seen.add(label.toUpperCase());
    if (!(max > 0) || max > 100 || !isHalf(max)) return { error: `${label}: max marks must be from 0.5 to 100, in halves.` };
    questions.push({ label, max });
  }
  const sum = questions.reduce((n, q) => n + q.max, 0);
  const paperMax = r.paperMax === undefined || r.paperMax === null || r.paperMax === "" ? sum : Number(r.paperMax);
  if (!(paperMax > 0) || !isHalf(paperMax)) return { error: "Paper max must be a number above 0, in halves." };
  if (paperMax > sum) return { error: `Paper max (${paperMax}) can't be more than the questions' marks added up (${sum}).` };
  return { layout: { questions, paperMax } };
}

/**
 * The marks sheet of an Exam Cell layout: one column per question; the total is what was entered added up, and must
 * not go above the paper max (questions with a choice add up to more than it - see questionMarksError).
 */
export function sheetFromLayout(layout: MidMarksLayout): QuestionSheet {
  const part: SheetPart = {
    id: "L", label: "Questions", perQuestion: true, questions: layout.questions.length, marksEach: 0,
    choice: { kind: "ALL" }, max: layout.paperMax, questionMax: layout.questions.map((q) => q.max),
  };
  const columns: SheetColumn[] = layout.questions.map((q, i) => ({ key: `L${i + 1}`, label: q.label, max: q.max, partId: "L" }));
  return { paperMax: layout.paperMax, parts: [part], columns, source: "LAYOUT" };
}

/** Where a linked component's entry stands, for the marks page. */
export interface MidEntryState {
  midNumber: number;
  mode: MidMarksMode;
  /** Faculty may type into it now (FACULTY mode + a sheet). */
  facultyCanEdit: boolean;
  /** Why not, in words, when the faculty can't. */
  note?: string;
  /** The Exam Cell submitted (locked) this Mid's marks for the section. */
  lockedByExamCell?: boolean;
}

export function entryStateFor(midNumber: number, mode: MidMarksMode, hasSheet: boolean, locked: boolean, open = true): MidEntryState {
  if (mode === "EXAM_CELL") {
    return { midNumber, mode, facultyCanEdit: false, lockedByExamCell: locked, note: locked ? "Entered and submitted by the Exam Cell." : "The Exam Cell uploads these marks." };
  }
  // Faculty entry opens only when the Exam Cell opens it, after the Mid's exams (midMarksOpen).
  if (!open) {
    return { midNumber, mode, facultyCanEdit: false, note: `Opens when the Exam Cell opens Mid-${midNumber} marks entry, after the exam.` };
  }
  if (!hasSheet) {
    return { midNumber, mode, facultyCanEdit: false, note: "Opens once the Exam Cell finalizes this Mid's question paper (or sets its questions)." };
  }
  return { midNumber, mode, facultyCanEdit: true };
}
