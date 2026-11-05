import type { Timestamp } from "firebase/firestore";
import type { BloomLevel } from "./midQuestionBank";

// ─── Mid question papers (a college that prepares papers instead of a bank) ───────────────────────────────
// colleges/{c}/midPaperPatterns/{courseKey}__{regulation|ALL}   Exam Cell: the paper's parts, marks, sets per faculty.
// A faculty member's papers are a midQuestionBanks doc with kind "PAPERS" (same deadline, sections, approval);
// its questions are .../questions/{set}_{partId}_{no}.

/** What a part asks: choose the correct answer, fill in the blanks, short answers, or descriptive questions. */
export type PaperPartKind = "MCQ" | "FILL_BLANK" | "SHORT" | "DESCRIPTIVE";

/** Which questions of a part the student answers. */
export type PaperChoice =
  | { kind: "ALL" }
  /** Any `answer` of the part's questions. */
  | { kind: "ANY"; answer: number }
  /** Questions in OR pairs (1 or 2, 3 or 4 ...); one of each pair. */
  | { kind: "OR_PAIRS" };

export interface PaperPartDef {
  id: string; // "A", "B" ...
  label: string; // "Part A"
  title: string; // "Choose the correct answer"
  /**
   * The Exam Cell fixes only the part's max marks (and `choice`): each faculty member builds it in each paper -
   * any mix of kinds, each question with its own whole marks (see `flexibleProblem`). `kind` / `questions` /
   * `marksEach` / `options` / `maxSubParts` don't apply then.
   */
  flexible?: boolean;
  /** Flexible parts: the part's max marks. Per-unit parts: what the part COUNTS for in marks entry (the raw total scales to it). */
  maxMarks?: number;
  /**
   * Fixed part set per unit: this many questions for each unit the subject's Mid covers (Mid Configuration > units
   * per Mid). A started paper's copy has `questions` = units x perUnit; the printed paper shows the raw total, and
   * marks entry scales the part to `maxMarks`.
   */
  perUnit?: number;
  /** A started paper's per-unit part: each question's unit, in order (a unit two Mids share gets half its questions). */
  unitLayout?: number[];
  kind: PaperPartKind;
  questions: number;
  marksEach: number;
  choice: PaperChoice;
  /** MCQ: options per question (2-6). */
  options?: number;
  /** Descriptive: a question may be split into up to this many sub-parts (a), (b) ... whose marks add up. 1 = no split. */
  maxSubParts?: number;
}

export interface MidPaperPattern {
  id: string;
  courseKey: string;
  courseName: string;
  /** "ALL" = every regulation of the course without a pattern of its own. */
  regulation: string;
  /** How many question papers (sets) each faculty member submits for a subject. */
  setsPerFaculty: number;
  durationMinutes: number;
  instruction: string;
  regdBoxes: number;
  parts: PaperPartDef[];
  updatedBy: string;
  updatedByName: string;
  updatedAt: Timestamp;
}

export interface PaperSubPart {
  text: string;
  marks: number;
  imageUrl?: string;
  imageCaption?: string;
}

/** One question of one set. */
export interface MidPaperQuestion {
  id: string; // `${set}_${partId}_${no}`
  set: number; // 1..setsPerFaculty
  partId: string;
  no: number; // 1..part.questions
  /** The question (descriptive with sub-parts: an optional lead-in). Formulas: LaTeX between $...$. */
  text: string;
  imageUrl?: string;
  imageCaption?: string;
  /** Flexible parts: this question's kind and whole marks, picked by the faculty. */
  kind?: PaperPartKind;
  marks?: number;
  /** MCQ: the options, in order (a), (b) ... */
  options?: string[];
  /** MCQ: index of the correct option; fill in the blank: the answer. Shown on the Exam Cell's key only. */
  answer?: string;
  /** Descriptive split into (a), (b) ...; their marks add up to the part's marks. */
  subParts?: PaperSubPart[];
  unit?: number;
  cos: string[];
  bloom: BloomLevel | "";
  state: "DRAFT" | "COMPLETE";
  rev: number;
  textKeys: string[];
  updatedBy: string;
  updatedByName: string;
  updatedAt: Timestamp;
}

/** Per set: how many of its questions are complete. */
export type PaperSetProgress = Record<string, { complete: number; total: number; problems?: string[] }>;
