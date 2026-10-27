import type { Timestamp } from "firebase/firestore";

// ─── Mid Question Bank ──────────────────────────────────────────────────────
// The Exam Cell sets a deadline per Course + Year + Semester + Mid; every faculty
// member teaching a subject of that semester can then prepare a bank for it,
// per branch + subject, covering the sections they pick (theirs, and colleagues'
// sections of the same subject in that branch, who then see it read-only).
//
//  colleges/{c}/midBankDeadlines/{id}          Exam Cell deadline (opens the module).
//  colleges/{c}/midBankRules/{id}              Exam Cell: units per Mid, format, marks.
//  colleges/{c}/subjectOutcomes/{subjectId}__{branchKey}   units, COs, PSOs and the
//      CO -> PO/PSO mapping of a subject in a branch; the first preparer enters
//      them and Mid 2 reuses them.
//  colleges/{c}/midQuestionBanks/{id}           one bank (see MidQuestionBank.id).
//  colleges/{c}/midBankSectionClaims/{deadlineId}__{subjectId}__{sectionId}
//      a section belongs to one bank only.
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
  branch: string;
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

/**
 * Exam Cell: the question bank deadline for one Course + Year + Semester + Mid.
 * Publishing it opens the Question Bank module for every faculty member teaching
 * a subject of that semester; banks lock when the deadline day ends (IST).
 */
export interface MidBankDeadline {
  id: string;
  courseKey: string; // course group key (buildCourseGroups)
  courseName: string;
  courseIds: string[]; // every Course doc of the programme (one per department)
  year: number;
  semester: number; // absolute, as Mid Timings store it (3 = 2nd year Sem 1)
  midNumber: number;
  deadline: string; // "YYYY-MM-DD", last day to write; locked from the next day
  extensions: { from: string; to: string; byName: string; at: string }[];
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MidBankSection {
  sectionId: string;
  sectionName: string;
  /** Who teaches the subject in this section (FacultyMember ids / names; usually one). */
  facultyIds: string[];
  facultyNames: string[];
}

export interface MidQuestionBank {
  id: string; // `${deadlineId}__${subjectId}__${branchKey}__${ownerFacultyId}`
  deadlineId: string;
  courseName: string;
  year: number;
  semester: number;
  midNumber: number;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  /** The branch (the sections' department) - banks are per branch + subject + Mid. */
  branch: string;
  /** subjectOutcomes doc id (subject + branch). */
  outcomesId: string;
  /** Sections this bank covers - its own and possibly colleagues'; each is claimed by one bank only. */
  sections: MidBankSection[];
  ownerFacultyId: string;
  ownerName: string;
  ownerUid: string;
  /** Everyone teaching a covered section (owner included) - they may read the bank. */
  viewerFacultyIds: string[];
  // Snapshot of the Exam Cell rules when the bank was started.
  units: number[];
  format: MidBankFormat;
  marks: number;
  unitStatus: Record<string, MidUnitStatus>;
  status: MidQuestionBankStatus;
  completeCount: number;
  totalCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
