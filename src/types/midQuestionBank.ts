import type { Timestamp } from "firebase/firestore";

// ─── Mid Question Bank ──────────────────────────────────────────────────────
// The Exam Cell sets a deadline per Course + Year + Semester + Mid; every faculty
// member teaching a subject of that semester can then prepare a bank for it,
// per branch + subject, covering the sections they pick (theirs, and colleagues'
// sections of the same subject in that branch, who then see it read-only).
//
//  colleges/{c}/midBankDeadlines/{id}          Exam Cell deadline (opens the module).
//  colleges/{c}/midBankRules/{id}              Exam Cell: units per Mid, format, marks.
//  colleges/{c}/subjectOutcomes/{subjectId}__{branchKey}   units, COs and the
//      CO -> PO/PSO mapping (ticked; PO1-PO11, PSO1-PSO2) of a subject in a branch; the first preparer enters
//      them and Mid 2 reuses them.
//  colleges/{c}/midQuestionBanks/{id}           one bank (see MidQuestionBank.id).
//  colleges/{c}/midBankSectionClaims/{deadlineId}__{subjectId}__{sectionId}
//      a section belongs to one bank only.
//  .../midQuestionBanks/{id}/questions/{unit}_{slot}   one doc per slot.

export type BloomLevel = "L2" | "L3" | "L4";

export interface SyllabusUnit {
  no: number; // 1..n, in order
  title: string;
  /** The unit's syllabus - its topics, as in the syllabus copy (optional). */
  syllabus?: string;
}

export interface CourseOutcome {
  id: string; // "CO1".."COn"
  statement: string;
  /** The unit this CO belongs to (subject syllabus); absent in older per-branch setups. */
  unit?: number;
}


/** CO id -> the POs / PSOs it maps to (ticked, no strength level), e.g. { CO1: ["PO1", "PO2", "PSO1"] }. */
export type OutcomeMapping = Record<string, string[]>;

export interface SubjectOutcomes {
  subjectId: string;
  branch: string;
  subjectName: string;
  subjectCode: string;
  units: SyllabusUnit[];
  cos: CourseOutcome[];
  mapping: OutcomeMapping;
  version: number; // bumped on every save; a save must name the version it edited
  updatedBy: string;
  updatedByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** How one question is set: one question, or parts (a) + (b) [+ (c) ...] with the marks split by the faculty. */
export type MidQuestionFormat = "SINGLE" | "PARTS_AB" | "PARTS_ABC" | "PARTS_ABCD" | "PARTS_ABCDE";
/** Older rules / banks: one format, or EITHER (one question or (a) + (b)). Read through `allowedFormats`. */
export type MidBankFormat = "SINGLE" | "PARTS_AB" | "EITHER";

export interface MidBankRules {
  id: string;
  /** Course group key: the catalog course id, or `name:<lower-case name>` (buildCourseGroups). */
  courseKey: string;
  courseName: string;
  /** "ALL" = every regulation of the course without a rule of its own. */
  regulation: string;
  /** Mid number -> the unit numbers it covers, in unlock order. */
  mids: Record<string, number[]>;
  /**
   * The split for a subject with a given number of units ("5" -> Mid number ->
   * units), e.g. 5 units: Mid 1 = 1, 2, 3 and Mid 2 = 3, 4, 5. A count with no
   * split here uses `mids`.
   */
  unitSplits?: Record<string, Record<string, number[]>>;
  /** The question types the faculty may pick from, per question (Exam Cell ticks them). */
  formats?: MidQuestionFormat[];
  /** Older rules only - see `allowedFormats`. */
  format?: MidBankFormat;
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
 * HOD approval of a complete bank: the faculty submits it, the branch's HOD
 * approves it (it then goes to the Exam Cell's question papers) or returns it
 * with remarks (the faculty can edit and submit again). Absent = not submitted.
 */
export type MidBankApproval = "SUBMITTED" | "APPROVED" | "RETURNED";
export interface MidBankApprovalEntry { at: string; byUid: string; byName: string; action: MidBankApproval | "WITHDRAWN"; remarks?: string; /** The department whose HOD it went to / decided it (the subject's department, else the branch). */ department?: string }

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
  /** The section's branch - set on a paper prepared for every branch of the subject (`branches`). */
  branch?: string;
}

/**
 * "The HOD assigns" colleges (ExamMidSettings.midAssignment = HOD): who prepares a subject's bank / papers for one
 * deadline. colleges/{c}/midBankAssignments/{deadlineId}__{subjectId}__{branchKey | all-branches}.
 * BRANCH = for one branch (each branch its own paper); GROUP = one paper for some branches (`branch` = their names
 * joined by " + ", `branches`); SUBJECT = one paper used by every branch (`branches`).
 * Several setters may be assigned; each prepares their own.
 */
export interface MidBankAssignment {
  id: string;
  deadlineId: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  scope: "BRANCH" | "GROUP" | "SUBJECT";
  /** The branch, a group label ("CSE + EEE" in full names) for GROUP, or ALL_BRANCHES for a SUBJECT assignment. */
  branch: string;
  branches: string[];
  facultyIds: string[];
  facultyNames: string[];
  /** Question papers shared among the setters (facultyId -> the papers they write, e.g. { A: [1], B: [2], C: [3] });
   *  absent = each setter writes every paper. */
  setShare?: Record<string, number[]>;
  assignedByUid: string;
  assignedByName: string;
  at: string;
  history?: { at: string; byName: string; facultyNames: string[] }[];
}

/** A suggestion a colleague (read-only viewer) leaves on a bank / paper set: .../midQuestionBanks/{id}/suggestions/{id}. */
export interface MidBankSuggestion {
  id: string;
  /** The question it is about (question doc id), or absent = the whole bank / paper. */
  questionId?: string;
  questionLabel?: string;
  text: string;
  byUid: string;
  byName: string;
  at: string;
  resolved?: { at: string; byName: string } | null;
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
  /** The branch (the sections' department) - banks are per branch + subject + Mid. ALL_BRANCHES / a group label = one paper for every branch in `branches`. */
  branch: string;
  /** A paper prepared for the whole subject ("The HOD assigns", SUBJECT scope): every branch it is used by. */
  branches?: string[];
  /** Started under an HOD assignment (sections are the scope's, not picked; no section claims). */
  assignmentId?: string;
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
  formats?: MidQuestionFormat[];
  /** Older banks only - see `allowedFormats`. */
  format?: MidBankFormat;
  marks: number;
  unitStatus: Record<string, MidUnitStatus>;
  status: MidQuestionBankStatus;
  /** The college's academic tags when the bank started (absent = all on): COs, CO-PO mapping, Bloom's levels. */
  outcomes?: import("./examMidSchedule").MidOutcomeSwitches;
  completeCount: number;
  totalCount: number;
  /** "PAPERS": ready question papers (sets) to the Exam Cell's pattern instead of a bank (absent = a bank). */
  kind?: "BANK" | "PAPERS";
  /** PAPERS: the pattern as it was when started, and each set's progress. */
  pattern?: import("./midPaperSet").MidPaperPattern;
  setProgress?: import("./midPaperSet").PaperSetProgress;
  approval?: MidBankApproval;
  approvalHistory?: MidBankApprovalEntry[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Exam Cell exception: one subject's own Mid units, whatever its unit count. colleges/{c}/midBankSubjectSplits/{subjectId} */
export interface MidBankSubjectSplit {
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  courseKey: string;
  regulation: string;
  mids: Record<string, number[]>;
  updatedBy: string;
  updatedByName: string;
  updatedAt: Timestamp;
}
