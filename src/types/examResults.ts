import type { Timestamp } from "firebase/firestore";

// ─── Semester (end-exam) results, imported in bulk by the Exam Cell ──────────
// Separate from Internal Exam marks (exams.ts), which faculty enter themselves.
// Results are GRADE based: each subject gets a letter grade, each grade carries
// points, each subject its credits, and SGPA / CGPA follow from those (see
// lib/examResults/gpa.ts for the two formulas, which are the same for every
// college). What differs per college - the grade table and WHEN an SGPA / CGPA
// may be shown - is the Exam Cell's own setting, ExamResultRules below.

/** One row of a grade table: "S" is worth 10 points and is a pass. */
export interface GradeRule {
  grade: string;
  points: number;
  isPass: boolean;
}

/**
 * ALL_PASSED: the figure is given only once every subject it covers is passed
 * (SGPA: that semester's subjects; CGPA: every semester so far).
 * ALWAYS: the figure is always worked out, a failed subject counting 0 points.
 */
export type GpaShowRule = "ALL_PASSED" | "ALWAYS";

/** Key of the grade table used when a regulation has none of its own. */
export const DEFAULT_GRADE_TABLE_KEY = "DEFAULT";

// Stored at colleges/{id}/examResultRules/rules - one document per college.
export interface ExamResultRules {
  // Grade table per regulation code ("R20", "R23"), plus DEFAULT_GRADE_TABLE_KEY.
  gradeTables: Record<string, GradeRule[]>;
  showSgpa: GpaShowRule;
  showCgpa: GpaShowRule;
  /** Decimal places SGPA / CGPA are shown to. */
  decimals: number;
  /**
   * What CGPA multiplies each semester's credits by: the SGPA as PRINTED
   * (rounded to `decimals` - the university's way, checked against real grade
   * memos), or the EXACT unrounded SGPA. Absent = PRINTED.
   */
  cgpaFrom?: "PRINTED" | "EXACT";
  updatedBy?: string;
  updatedByName?: string;
  updatedAt?: Timestamp;
}

export type ExamResultType = "REGULAR" | "SUPPLEMENTARY" | "REVALUATION";
/** The sitting types a revaluation can re-grade. */
export type RevaluableExamType = "REGULAR" | "SUPPLEMENTARY";
export type ExamResultBatchStatus = "DRAFT" | "PUBLISHED";

// Stored at colleges/{id}/semesterResultBatches/{id} - one per results sheet
// the Exam Cell imports (a course-year-semester's Regular exam, or one
// Supplementary sitting of it). DRAFT is the Exam Cell's alone; PUBLISHED is
// what students, HODs and the Principal are shown.
export interface ExamResultBatch {
  id: string;
  collegeId: string;
  title: string;
  // The programme (see buildCourseGroups): its catalog id, or a name key for a
  // course created before the catalog existed. `courseIds` are the Course docs
  // (one per department) that make it up.
  courseKey: string;
  courseName: string;
  courseIds: string[];
  /** The branch (department) the sheet is for - every student in it belongs to this branch. */
  department: string;
  departmentId: string;
  /** Optional: one sub-department of the branch - then every student belongs to it. */
  subDepartment?: string;
  subDepartmentId?: string;
  /** Regulation whose grade table applies. */
  regulation: string;
  /** The student cohort as configured on the regulation ("2024-2028"). */
  batch: string;
  /** Month the exam was held, "YYYY-MM". */
  examHeld: string;
  /** Supplementary: the exam it re-sits; Revaluation: the exam it re-grades. */
  targetBatchId?: string;
  /** The same, as an exam across branches (type + month) - each student matched to their own result in it. */
  targetExam?: { examType: "REGULAR" | "SUPPLEMENTARY"; examHeld: string };
  /** Shared by the sheets of one every-branch upload (one per branch / sub-department). */
  uploadId?: string;
  academicYear: string;
  year: number;
  semester: number;
  examType: ExamResultType;
  /** REVALUATION sheets only: which sitting of this academic year + semester it re-grades. */
  revaluationOf?: RevaluableExamType;
  status: ExamResultBatchStatus;
  studentCount: number;
  subjectRowCount: number;
  createdBy: string;
  createdByName: string;
  publishedBy?: string;
  publishedByName?: string;
  publishedAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** One subject's result for one student - the grade only (internal marks stay
 *  with the faculty's Internal Exam flow). Credits, points and pass/fail are
 *  SNAPSHOTS taken at import, so a published result never changes because a
 *  subject or the grade table was edited afterwards. */
export interface ExamResultSubject {
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  credits: number;
  /** A letter grade ("S", "A" ...) - or "Pass" / "Fail" for a zero-credit subject. */
  grade: string;
  points: number;
  isPass: boolean;
  /** Zero-credit subjects: the grade exactly as the file gave it ("S", "P", "AB" ...), kept for the record. */
  gradeAsGiven?: string;
}

// Stored at colleges/{id}/semesterResults/{batchId}_{studentId} - one document
// per student per batch, carrying every subject of that sheet. `status`,
// `year`, `semester` and `examType` repeat the batch's so a student's results
// can be read with equality filters alone (no composite index).
export interface ExamResultRecord {
  id: string;
  collegeId: string;
  batchId: string;
  /** The batch's programme key - what a student's earlier results for a semester are found by. */
  courseKey: string;
  studentId: string;
  rollNumber: string;
  rollNumberUpper: string;
  name: string;
  department: string;
  courseId?: string;
  regulation: string;
  academicYear: string;
  year: number;
  semester: number;
  batch: string;
  examHeld: string;
  /** The university's SGPA from the file, when given (null = "-"); only compared with ours. */
  universitySgpa?: number | null;
  examType: ExamResultType;
  /** REVALUATION only: the sitting re-graded (its type, and the student's record's batch). */
  revaluationOf?: RevaluableExamType;
  revaluesBatchId?: string;
  status: ExamResultBatchStatus;
  subjects: ExamResultSubject[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
