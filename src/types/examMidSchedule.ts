import type { Timestamp } from "firebase/firestore";

// colleges/{collegeId}/examSettings/mid — single college-wide doc: how many
// mid-semester exams this college runs. Drives the Mid dropdown in
// ExamMidSchedule publishing (1..midCount) — set once by Exam Cell in Settings.
export interface ExamMidSettings {
  midCount: number;
  /** How faculty prepare a Mid: a question bank (default) or ready question papers (sets). */
  midPreparation?: MidPreparation;
  /** Who prepares: everyone teaching the subject starts their own (SELF, default), or the subject's HOD assigns the setters (HOD). */
  midAssignment?: MidAssignment;
  /** Which academic tags this college uses on questions (missing = all on). */
  outcomes?: Partial<MidOutcomeSwitches>;
  updatedAt?: Timestamp;
  updatedByName?: string;
}

export type MidPreparation = "BANK" | "PAPERS";
export type MidAssignment = "SELF" | "HOD";

/** Course Outcomes, CO-PO/PSO mapping and Bloom's levels - each can be switched off for a college. */
export interface MidOutcomeSwitches {
  cos: boolean;
  /** Needs `cos`. */
  poMapping: boolean;
  bloom: boolean;
}

// colleges/{collegeId}/examMidSchedules/{id} — one doc per published
// Course+Semester+Mid date/time window. Multiple docs may share the same
// Course+Semester+Mid (re-scheduling adds a new one rather than requiring a
// destructive edit) - no uniqueness enforced.
export interface ExamMidSchedule {
  id: string;
  collegeId: string;
  courseId?: string;
  courseName: string;
  semester: number; // e.g. 3, paired with totalSemesters for the "3/8" label
  totalSemesters: number;
  midNumber: number; // 1..ExamMidSettings.midCount at publish time
  fromDate: string; // "YYYY-MM-DD"
  toDate: string;
  fromTime: string; // "HH:mm"
  toTime: string;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
