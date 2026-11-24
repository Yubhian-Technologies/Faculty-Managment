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
  /** Per column key of the sheet: a mark, "NA" (not attempted) or null (not entered yet). */
  q: Record<string, MidQuestionValue>;
  /** The paper total once every box is filled (or absent = 0); null while any box is empty. */
  total: number | null;
}

export type MidMarksHistoryAction = "SUBMITTED" | "WITHDRAWN" | "FROZEN" | "REOPENED" | "CHANGE_REQUESTED" | "CHANGE_APPROVED" | "CHANGE_REJECTED";
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
  /** The printed paper's question layout, frozen when the sheet was first opened. */
  sheet: QuestionSheet;
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
