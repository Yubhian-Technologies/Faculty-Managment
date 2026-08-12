import type { Timestamp } from "firebase/firestore";

// ─── Exam Cell configuration ────────────────────────────────────────────────
// One document per (Course, Year, Branch) — the single source of truth for
// every subject taught under that course/year/branch's Internal/External
// maximum marks and how Internal marks break down into components. Deliberately
// NOT scoped to a subject: the Exam Cell sets one breakdown that applies to
// every subject in that course-year-branch (e.g. DSA, DBMS, ... all share it),
// mirroring the existing per-(courseId,year) CourseYearTiming doc id pattern.
// The Faculty Dashboard's Internal Exam module reads this live (never copies/
// snapshots it), so an Exam Cell edit is reflected there immediately with no
// faculty-side code change.

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
  id: string; // == `${courseId}_year${year}` — one configuration per course+year (branch is implied by courseId)
  collegeId: string;
  courseId: string;
  courseName: string;
  department: string;
  year: number;
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
