import type { Timestamp } from "firebase/firestore";

// ─── Internal Exam (Faculty mark entry) ────────────────────────────────────
// Faculty (PANEL_MEMBER) marks entry for a section+subject they're currently
// assigned to teach (see teachingAssignments). The Internal marks structure
// itself — maximum marks and how they break into components — is NOT defined
// here: it's owned entirely by the Exam Cell's ExamConfiguration for that
// subject (see examConfig.ts) and read live, so an Exam Cell edit is
// reflected on this page immediately with no code change on this side.

export type InternalExamMarksStatus = "DRAFT" | "SUBMITTED";

export interface InternalExamMarkEntry {
  studentId: string;
  rollNumber: string;
  name: string;
  // Keyed by ExamConfiguration component id — absent/undefined until entered.
  componentMarks: Record<string, number | null>;
}

export interface InternalExamMarksBatch {
  id: string; // == assignmentId — one batch per (faculty, section, subject)
  collegeId: string;
  department: string;
  // The source teachingAssignments doc — teaching assignments come in two
  // shapes (see TeachingAssignment): course/section-scoped ones carry a real
  // sectionId to resolve the roster from; semester-scoped ones only carry a
  // free-text section name, so sectionId is absent there.
  assignmentId: string;
  sectionId?: string;
  sectionName: string;
  year?: number;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  facultyId: string;
  facultyName: string;
  status: InternalExamMarksStatus;
  entries: InternalExamMarkEntry[];
  totalStudents: number;
  enteredCount: number;
  submittedAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
