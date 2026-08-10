import type { Timestamp } from "firebase/firestore";

// ─── Student Attendance (Faculty marks present/absent for a class session) ───
// Faculty (PANEL_MEMBER) marks attendance for a section+subject they're
// currently assigned to teach (see teachingAssignments), for one calendar
// date. Unlike internalExamMarks (one batch per assignment, ever), a session
// exists per (assignment, date) — doc id: `${assignmentId}_${date}`.

export type StudentAttendanceMark = "PRESENT" | "ABSENT";

export const STUDENT_ATTENDANCE_MARK_LABELS: Record<StudentAttendanceMark, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
};

export type StudentAttendanceSessionStatus = "DRAFT" | "SUBMITTED";

export interface StudentAttendanceEntry {
  studentId: string;
  rollNumber: string;
  name: string;
  status: StudentAttendanceMark | null; // null until marked
}

export interface StudentAttendanceSession {
  id: string; // `${assignmentId}_${date}`
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
  date: string; // "YYYY-MM-DD"
  status: StudentAttendanceSessionStatus;
  entries: StudentAttendanceEntry[];
  totalStudents: number;
  presentCount: number;
  submittedAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
