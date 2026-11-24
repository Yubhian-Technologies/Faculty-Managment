import type { QuestionSheet } from "@/lib/exams/questionMarks";

// Faculty > Mid Marks (colleges that turn on examSettings/mid.midMarksPage): one sheet per section's teaching
// assignment and Mid, entered question by question against the paper the Exam Cell printed for that subject +
// branch. Stored out of the paper's own marks - never scaled. Kept apart from internal marks, so it works before a
// college sets up its internal marks.
//   colleges/{c}/midMarksSheets/{assignmentId}__m{mid}

export type MidMarksSheetStatus = "DRAFT" | "SUBMITTED";

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

export interface MidMarksHistoryItem { at: string; byName: string; action: "SUBMITTED" | "REOPENED"; reason?: string }

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
  history?: MidMarksHistoryItem[];
}
