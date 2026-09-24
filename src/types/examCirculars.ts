import type { Timestamp } from "firebase/firestore";

// ─── Exam Cell circulars ────────────────────────────────────────────────────
// Two ways Exam Cell puts out a circular, sharing one list/feed:
//  - FILE: a PDF/Word notice uploaded as-is (no text extraction, unlike
//    ExamGuideline - a circular is an official notice, not a list to reformat).
//  - NOTICE: a short structured announcement typed directly in - Course,
//    Semester, Date, Subject, Body - with no file at all.
// Not yet surfaced anywhere outside the Exam Cell dashboard - see the same
// note on ExamGuideline: there is no student login/portal in this app yet, so
// "share to students" only saves it here for now.

export type ExamCircularFileType = "pdf" | "docx";
export type ExamCircularKind = "FILE" | "NOTICE";

export interface ExamCircular {
  id: string;
  collegeId: string;
  kind: ExamCircularKind;
  title: string; // FILE: file name-derived. NOTICE: same as `subject`, kept in sync so both kinds share one heading field.
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;

  // FILE only
  fileUrl?: string;
  fileName?: string;
  fileType?: ExamCircularFileType;

  // NOTICE only
  courseId?: string;
  courseName?: string; // "B.Tech" - a program name, not one branch/department
  semester?: number; // e.g. 3, paired with totalSemesters for the "3/8" label - durationYears * 2, not the year
  totalSemesters?: number;
  subject?: string; // the circular's own subject line/heading, NOT an academic subject like "Data Structures"
  noticeDate?: string; // "YYYY-MM-DD" - the date the notice concerns, not createdAt
  body?: string;
}
