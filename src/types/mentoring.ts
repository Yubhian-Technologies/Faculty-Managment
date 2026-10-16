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
  /** The HOD themselves - an HOD may mentor students too. */
  isSelf?: boolean;
}

// ─── Mentoring Record (the college's "Student Mentoring Record" booklet) ──────
// Plain API shapes shared by the routes and the record pages. Nothing here is a
// stored shape except MentoringEntry (students/{id}/mentoringEntries/{entryId}),
// the overrides doc (students/{id}/mentoringProfile/record) and the semester doc
// (students/{id}/mentoringSemesters/{n}) - see lib/mentoring/*.

/** Where a value on the record came from. */
export type RecordValueSource = "STUDENT" | "MENTOR" | "DERIVED";

export type RecordFieldKind = "text" | "date" | "phone" | "email" | "landline" | "address";

/** One field of page 1 / 7.1: the value, who it came from, and whether the mentor may fill it. */
export interface RecordFieldView {
  key: string;
  label: string;
  kind: RecordFieldKind;
  value: string;
  /** null = nobody has provided it yet. */
  source: RecordValueSource | null;
  /** True only while the value is missing (a value already on the student's record is never overwritten here). */
  editable: boolean;
}

export interface RecordProfileGroup {
  id: "student" | "father" | "mother" | "guardian";
  title: string;
  fields: RecordFieldView[];
}

export interface QualifyingRow {
  exam: string;
  prefix: "ssc" | "inter" | "diploma";
  institution: RecordFieldView;
  yearOfPass: RecordFieldView;
  board: RecordFieldView;
  percentage: RecordFieldView;
}

export interface MentoringRecordProfile {
  groups: RecordProfileGroup[];
  qualifying: QualifyingRow[];
  /** Fields still missing that the mentor can fill (drives the "n details missing" hint). */
  missingCount: number;
}

/** A row of one of the record's tables / lists (scholarship, internship, meeting, ...). */
export interface MentoringEntry {
  id: string;
  section: string;
  semester: number | null;
  values: Record<string, string | boolean>;
  createdByName: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export type SubjectsSource = "SNAPSHOT" | "LIVE" | "RESULTS" | "ATTENDANCE" | "NONE";

export interface SheetInternalComponent { name: string; maxMarks: number | null; marks: number | null }

export interface SheetSubject {
  subjectId: string;
  code: string;
  name: string;
  credits: number | null;
  /** Attendance %, cumulative from the semester's start: up to Mid I, up to Mid II, end of semester (so far). null = not available. */
  attendance: { mid1: number | null; mid2: number | null; end: number | null };
  internal: { components: SheetInternalComponent[]; total: number | null; maxTotal: number | null } | null;
  grade: { grade: string; points: number; isPass: boolean } | null;
}

export interface SheetBacklog {
  code: string;
  name: string;
  /** The regular sitting first, then each supplementary one, oldest first. */
  attempts: { label: string; grade: string; isPass: boolean }[];
}

export interface MentoringSemesterSheet {
  semester: number;
  year: number | null;
  /** Position within its year (1 / 2). */
  inYear: number | null;
  academicYear: string;
  regulation: string;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  subjectsSource: SubjectsSource;
  /** One plain sentence on how the subject list was obtained (shown under the table). */
  subjectsNote: string;
  mids: { mid1: string | null; mid2: string | null };
  attendanceTo: { mid1: string | null; mid2: string | null; end: string | null };
  subjects: SheetSubject[];
  attendanceOverall: { mid1: number | null; mid2: number | null; end: number | null };
  backlogs: SheetBacklog[];
  overall: {
    published: boolean;
    creditsEarned: number;
    creditsRegistered: number;
    sgpa: number | null;
    sgpaWithheld: boolean;
    cgpa: number | null;
    cgpaWithheld: boolean;
    backlogCodes: string[];
    decimals: number;
  };
  remarks: { text: string; byName: string; at: string | null } | null;
  meetingCount: number;
}

export interface MentoringSemesterOption {
  semester: number;
  /** "I Year · Semester I" - the booklet's own wording. */
  label: string;
  isCurrent: boolean;
}
