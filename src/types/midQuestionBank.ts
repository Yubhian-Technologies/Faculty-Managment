import type { Timestamp } from "firebase/firestore";

// ─── Mid Question Bank ──────────────────────────────────────────────────────
// Built on top of the HOD's Mid Paper Setter assignment (midPaper.ts): the
// assigned faculty writes the question bank for that subject + Mid.
//
//  colleges/{c}/subjectOutcomes/{subjectId}   units, Course Outcomes, PSOs and
//      the CO -> PO/PSO mapping. Entered once by the assigned faculty (or the
//      subject's HOD) in the bank setup; shared by both Mids of the subject.
//  colleges/{c}/midBankRules/{id}             Exam Cell: which units each Mid
//      covers, the question format and marks, per course (+ regulation).
//  colleges/{c}/midQuestionBanks/{assignmentId}   one bank per assignment
//      (same id), with a snapshot of the rules taken when it was started.
//  .../midQuestionBanks/{id}/questions/{unit}_{slot}   one doc per slot.

export type BloomLevel = "L2" | "L3" | "L4";
export type CorrelationLevel = 1 | 2 | 3;

export interface SyllabusUnit {
  no: number; // 1..n, in order
  title: string;
}

export interface CourseOutcome {
  id: string; // "CO1".."COn"
  statement: string;
}

export interface ProgramSpecificOutcome {
  id: string; // "PSO1".."PSOn"
  statement: string;
}

/** CO id -> PO/PSO id -> correlation 1 (low) .. 3 (high). Absent = no correlation. */
export type OutcomeMapping = Record<string, Record<string, CorrelationLevel>>;

export interface SubjectOutcomes {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  units: SyllabusUnit[];
  cos: CourseOutcome[];
  psos: ProgramSpecificOutcome[];
  mapping: OutcomeMapping;
  version: number; // bumped on every save; a save must name the version it edited
  updatedBy: string;
  updatedByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** How one question is set: one question, or parts (a) and (b) with the marks split by the faculty. */
export type MidQuestionFormat = "SINGLE" | "PARTS_AB";
/** What the Exam Cell allows in a bank: always one, always parts, or EITHER (faculty picks per question). */
export type MidBankFormat = MidQuestionFormat | "EITHER";

export interface MidBankRules {
  id: string;
  /** Course group key: the catalog course id, or `name:<lower-case name>` (buildCourseGroups). */
  courseKey: string;
  courseName: string;
  /** "ALL" = every regulation of the course without a rule of its own. */
  regulation: string;
  /** Mid number -> the unit numbers it covers, in unlock order. */
  mids: Record<string, number[]>;
  format: MidBankFormat;
  marks: number; // per question (parts split it - see MidQuestionPart.marks)
  updatedBy: string;
  updatedByName: string;
  updatedAt: Timestamp;
}

export interface MidQuestionPart {
  /** Plain text; formulas are LaTeX between $...$ (inline) or $$...$$ (display). */
  text: string;
  imageUrl?: string;
  imageCaption?: string;
  cos: string[];
  bloom: BloomLevel | "";
  /** This part's marks. One-part questions carry the bank's marks; parts must add up to them. */
  marks?: number;
}

export type MidQuestionState = "DRAFT" | "COMPLETE";

export interface MidQuestion {
  id: string; // `${unit}_${slot}`
  unit: number;
  slot: number; // 1..QUESTIONS_PER_UNIT
  /** This question's format (absent on older docs = the bank's own format). */
  format?: MidQuestionFormat;
  parts: MidQuestionPart[];
  state: MidQuestionState;
  /** Optimistic-concurrency counter: a save must name the rev it edited. */
  rev: number;
  /** Normalised text of each part, for the duplicate check. */
  textKeys: string[];
  updatedBy: string;
  updatedByName: string;
  updatedAt: Timestamp;
}

export interface MidUnitStatus {
  complete: boolean;
  completeCount: number;
  draftCount: number;
  bloom: Record<BloomLevel, number>;
}

export type MidQuestionBankStatus = "IN_PROGRESS" | "COMPLETE";

export interface MidQuestionBank {
  id: string; // = MidPaperAssignment id
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  midNumber: number;
  facultyId: string;
  department: string;
  // Snapshot of the Exam Cell rules when the bank was started.
  units: number[];
  format: MidBankFormat;
  marks: number;
  unitStatus: Record<string, MidUnitStatus>;
  status: MidQuestionBankStatus;
  completeCount: number;
  totalCount: number;
  startedBy: string;
  startedByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
