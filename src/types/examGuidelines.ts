import type { Timestamp } from "firebase/firestore";

// ─── Exam Cell guidelines ───────────────────────────────────────────────────
// A PDF/Word document Exam Cell uploads; its text is auto-extracted into a
// point-wise list at upload time (no manual editing step - see
// lib/examGuidelines/extractPoints.ts). Not yet surfaced anywhere outside the
// Exam Cell dashboard - there is no student login/portal in this app yet for
// an "Exam Guidelines" tab to live on.

export type ExamGuidelineFileType = "pdf" | "docx";

export interface ExamGuideline {
  id: string;
  collegeId: string;
  title: string;
  points: string[];
  fileUrl: string;
  fileName: string;
  fileType: ExamGuidelineFileType;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
