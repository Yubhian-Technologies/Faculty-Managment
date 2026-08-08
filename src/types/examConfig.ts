import type { Timestamp } from "firebase/firestore";

// ─── Exam Cell configuration ────────────────────────────────────────────────
// One document per subject — the single source of truth for that subject's
// Internal/External maximum marks and how Internal marks break down into
// components. The Faculty Dashboard's Internal Exam module reads this live
// (never copies/snapshots it), so an Exam Cell edit is reflected there
// immediately with no faculty-side code change.

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
  id: string; // == subjectId — one configuration per subject
  collegeId: string;
  courseId: string;
  courseName: string;
  department: string;
  year: number;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
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
