import type { Timestamp } from "firebase/firestore";

// ─── Student mentoring ───────────────────────────────────────────────────────
// The HOD assigns students to a faculty member (one mentor per student, stored
// on the student record - see StudentRecord.mentorUid). The mentor follows the
// student's profile, attendance, semester results and internal marks, and keeps
// dated notes of their meetings.

// Stored at colleges/{id}/students/{studentId}/mentoringNotes/{noteId}.
export interface MentoringNote {
  id: string;
  text: string;
  /** Login uid / display name of the person who wrote it (the mentor, or the HOD). */
  authorUid: string;
  authorName: string;
  createdAt: Timestamp;
}

export const MENTORING_NOTE_MAX_LENGTH = 2000;

/** One row of a mentor's (or the HOD's) student list. */
export interface MenteeSummary {
  id: string;
  name: string;
  rollNumber: string;
  department: string;
  section: string;
  year: number;
  status: string;
  profilePhotoUrl?: string;
  mentorUid?: string;
  mentorName?: string;
}

/** A faculty member the HOD may pick as a mentor. */
export interface MentorOption {
  uid: string;
  name: string;
  department: string;
  designation: string;
  menteeCount: number;
}
