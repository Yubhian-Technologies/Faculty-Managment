import type { QuestionSheet } from "@/lib/exams/questionMarks";

// Faculty > Mid Marks (colleges that turn on examSettings/mid.midMarksPage): one sheet per section's teaching
// assignment and Mid, entered question by question against the paper the Exam Cell printed for that subject +
// branch. Stored out of the paper's own marks - never scaled. Kept apart from internal marks, so it works before a
// college sets up its internal marks.
//   colleges/{c}/midMarksSheets/{assignmentId}__m{mid}

/** DRAFT (faculty entering) -> SUBMITTED (with the Exam Cell; the faculty may withdraw it) -> FROZEN (final; a change
 *  needs a request the Exam Cell approves, which puts it back to DRAFT). */
export type MidMarksSheetStatus = "DRAFT" | "SUBMITTED" | "FROZEN";

/** "-" in a box: the student did not attempt that question (counts 0, but the box is filled). */
export const NOT_ATTEMPTED = "NA" as const;
export type MidQuestionValue = number | typeof NOT_ATTEMPTED | null;

export interface MidMarksEntry {
  studentId: string;
  rollNumber: string;
  name: string;
  /** Absent for the exam: every question counts 0 and the student is complete. */
  absent?: boolean;
  /** Format sheets: the parts (components) the student was absent for (AB, counts 0) - e.g. AB in the Descriptive
   *  and the Quiz but marks in the Course Activity. Absent in every part = `absent`. */
  abParts?: string[];
  /** Per column key of the sheet: a mark, "NA" (not attempted) or null (not entered yet). */
  q: Record<string, MidQuestionValue>;
  /** The paper total once every box is filled (or absent = 0); null while any box is empty. */
  total: number | null;
}

export type MidMarksHistoryAction = "SUBMITTED" | "WITHDRAWN" | "FROZEN" | "REOPENED" | "CHANGE_REQUESTED" | "CHANGE_APPROVED" | "CHANGE_REJECTED" | "UPLOADED" | "QUESTIONS_SET";

// ---- Mid exam format (colleges/{c}/midExamFormats/{courseKey}__{REG|ALL}) - lib/midMarks/format.ts ----
// What a Mid exam is made of, set by the Exam Cell per course + regulation (a subject may have its own):
//   QUESTIONS  written paper entered question by question (Descriptive: 6 questions x 10, OR pairs = 30)
//   ITEMS      many small items added up and scaled (Quiz: 20 x 1 mark -> out of 10)
//   MARK       one number (Course Activity 10, Day to Day Work 20)

export type MidFormatKind = "QUESTIONS" | "ITEMS" | "MARK";
export type MidFormatChoice = { kind: "ALL" } | { kind: "ANY"; answer: number } | { kind: "OR_PAIRS" };

export interface MidFormatComponent {
  /** Short id, unique in the format (P1, P2 ...) - the sheet's part id. */
  id: string;
  name: string;
  kind: MidFormatKind;
  /** What the component counts for (QUESTIONS: worked out from the questions and the choice). */
  max: number;
  /** QUESTIONS */
  questions?: number;
  marksEach?: number;
  choice?: MidFormatChoice;
  /** ITEMS */
  items?: number;
  itemMarks?: number;
}

export interface MidExamFormat {
  id: string;
  courseKey: string;
  courseName: string;
  /** "ALL" = every regulation of the course without its own format. */
  regulation: string;
  components: MidFormatComponent[];
  /** A subject with its own components (Engineering Drawing: Descriptive + Day to Day Work). */
  subjectFormats?: Record<string, { subjectCode: string; subjectName: string; components: MidFormatComponent[] }>;
  updatedAt: string;
  updatedByName: string;
}

/** One question of a section's paper: its sub-parts (none, or A, B ...) and the CO of each box (null = CO pending). */
export interface MidSectionQuestion { no: number; parts: string[]; cos: (string | null)[] }

/** What a format sheet was built from (kept on the sheet; COs may change at any time, the questions only while no
 *  marks are entered). */
export interface MidSheetFormat {
  components: MidFormatComponent[];
  /** Per QUESTIONS component id: the section's questions. */
  questions: Record<string, MidSectionQuestion[]>;
}
export interface MidMarksHistoryItem { at: string; byName: string; action: MidMarksHistoryAction; reason?: string }

/** A faculty member's request to change submitted / frozen marks. */
export interface MidMarksChangeRequest {
  status: "PENDING" | "APPROVED" | "REJECTED";
  reason: string;
  at: string;
  byName: string;
  decidedAt?: string;
  decidedByName?: string;
  remarks?: string;
}

export interface MidMarksSheet {
  id: string;
  assignmentId: string;
  subjectId: string;
  subjectCode?: string;
  subjectName: string;
  department: string;
  sectionId?: string;
  sectionName: string;
  courseId: string;
  courseKey: string;
  year?: number;
  semester?: number;
  midNumber: number;
  facultyId: string;
  facultyName: string;
  /** The printed paper's question layout, frozen when the sheet was first opened (format sheets: built from `format`). */
  sheet: QuestionSheet;
  /** Format sheets (Mid exam format colleges): the components + the section's questions and COs. */
  format?: MidSheetFormat;
  /** Entered by the Exam Cell (file upload) rather than the faculty. */
  enteredBy?: { kind: "EXAM_CELL"; byName: string; at: string; fileName?: string };
  entries: MidMarksEntry[];
  totalStudents: number;
  /** Students complete: every box filled, or absent. */
  completeCount: number;
  status: MidMarksSheetStatus;
  rev: number;
  createdAt: string;
  updatedAt: string;
  updatedByName: string;
  submittedAt?: string;
  frozenAt?: string;
  frozenByName?: string;
  /** The latest change request (one open at a time). */
  changeRequest?: MidMarksChangeRequest;
  /** Reopened by the Exam Cell (directly or by approving a request): editable even after the last date, until the
   *  next submit. */
  editGrant?: { at: string; byName: string };
  history?: MidMarksHistoryItem[];
}

/** The with-Mid CIE unit shown (read only) on a Mid marks sheet - entered on Faculty > CIE Marks. */
export interface MidSheetCie {
  unit: number;
  /** Out of; null until the CIE sheet is opened. */
  unitMarks: number | null;
  status: "NOT_STARTED" | "DRAFT" | "SUBMITTED";
  entered: number;
  total: number;
  /** studentId -> marks, or "AB" for absent; only students entered. */
  marks: Record<string, number | "AB">;
}
