import type { Timestamp } from "firebase/firestore";
import type { ExamType } from "./teaching";

// ─── Exam Cell configuration ────────────────────────────────────────────────
// One document per (Course, Year, Branch, Exam Type) — the single source of
// truth for every subject taught under that course/year/branch's Internal/
// External maximum marks and how Internal marks break down into components.
// Deliberately NOT scoped to a subject: the Exam Cell sets one breakdown per
// Theory/Lab that applies to every subject of that kind in that
// course-year-branch (e.g. DSA, DBMS, ... all share the Theory one), mirroring
// the existing per-(courseId,year) CourseYearTiming doc id pattern. Theory and
// Lab are stored as two entirely separate documents (see `examType` and
// examConfigId in lib/exams/internalExamMarks.ts) - never merged into one.
// The Faculty Dashboard's Internal Exam module reads this live (never copies/
// snapshots it), so an Exam Cell edit is reflected there immediately with no
// faculty-side code change; which of the two documents it reads is resolved
// from the subject's own SubjectType (PRACTICAL -> Lab, everything else ->
// Theory - see subjectTypeToExamType), never picked by the faculty.

export interface ExamConfigComponent {
  id: string;
  name: string;
  maxMarks: number;
  description?: string;
  order: number;
  isActive: boolean;
}

export type ExamConfigurationStatus = "ACTIVE" | "INACTIVE";

export interface ExamConfiguration {
  id: string; // == `${courseId}_year${year}_${examType}` — one configuration per course+year+examType (branch is implied by courseId)
  collegeId: string;
  courseId: string;
  courseName: string;
  department: string;
  year: number;
  // Absent on documents written before Theory/Lab were split into separate
  // configurations - such a legacy doc sits at the old `${courseId}_year${year}`
  // id, which current code never looks up, so it's effectively orphaned
  // rather than silently misread as one type or the other.
  examType?: ExamType;
  internalMaxMarks: number;
  externalMaxMarks: number;
  components: ExamConfigComponent[];
  status: ExamConfigurationStatus;
  createdBy: string;
  createdByName: string;
  updatedBy?: string;
  updatedByName?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
