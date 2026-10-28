import type { Timestamp } from "firebase/firestore";

// Mid Timetable: the Exam Cell's exam timetable for one Mid, one per branch.
//
//   colleges/{c}/midExamPlans/{planId}        one per course + year + semester + Mid:
//                                             the exam days and the sessions of a day.
//   colleges/{c}/midTimetables/{planId}__{branchKey}
//                                             one per branch (section department):
//                                             each Theory subject's day + session.

/** One exam session of a day, e.g. Morning 10:00-11:30. */
export interface MidExamSession {
  id: string; // "S1", "S2" ...
  label: string;
  from: string; // "HH:mm"
  to: string;
}

export interface MidExamPlan {
  id: string; // `${courseKey}__y${year}__s${semester}__m${midNumber}`
  courseKey: string;
  courseName: string;
  courseIds: string[];
  year: number;
  semester: number;
  midNumber: number;
  /** The date range exam days are picked from: the Mid's published dates, or the ones given when the timetable was made. */
  from?: string;
  to?: string;
  /** Exam days ("YYYY-MM-DD"), inside that range. */
  days: string[];
  sessions: MidExamSession[];
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  updatedByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * One subject's exam: its day and session. Several subjects of a branch in the
 * same day + session are electives (students write one); `group` is the cell's
 * heading, e.g. "Professional Elective-IV".
 */
export interface MidExamSlot {
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  date: string;
  sessionId: string;
  group?: string;
  /** Set when the exam was rescheduled (postponed / preponed): the date it was first published for. */
  movedFrom?: string;
}

/** One reschedule of a branch's exams, kept on the timetable as history. */
export interface MidTimetableChange {
  at: string; // ISO time
  byName: string;
  fromDate: string;
  fromSessionId: string;
  toDate: string;
  toSessionId: string;
  subjects: string[];
  reason: string;
  /** "ALL" when the whole year moved together, else this branch alone. */
  scope: "ALL" | "BRANCH";
}

export type MidTimetableStatus = "DRAFT" | "PUBLISHED";

export interface MidTimetable {
  id: string; // `${planId}__${branchKey}`
  planId: string;
  courseName: string;
  courseIds: string[];
  year: number;
  semester: number;
  midNumber: number;
  branch: string;
  slots: MidExamSlot[];
  /** The sessions as they were when published (viewers read these, never the plan). */
  sessions: MidExamSession[];
  status: MidTimetableStatus;
  rev: number;
  /** Reschedules, oldest first. */
  changes?: MidTimetableChange[];
  publishedAt?: Timestamp | null;
  publishedByName?: string;
  updatedBy: string;
  updatedByName: string;
  updatedAt: Timestamp;
}
