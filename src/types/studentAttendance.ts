import type { Timestamp } from "firebase/firestore";

// ─── Student Attendance (Faculty marks present/absent for a class session) ───
// Faculty (PANEL_MEMBER) marks attendance for a section+subject they're
// currently assigned to teach (see teachingAssignments), for one calendar
// date AND one specific published-timetable period. Unlike internalExamMarks
// (one batch per assignment, ever), a session exists per (assignment, date,
// period) — doc id: `${assignmentId}_${date}_${periodNumber}`. Consecutive
// periods for the same assignment on the same day (e.g. Period 1 then
// Period 2 of the same faculty/section/subject) are two independent
// sessions - each is its own fresh roster/marks/submission, never carried
// forward from the other (see /api/college/student-attendance).

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
  id: string; // `${assignmentId}_${date}_${periodNumber}`
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
  // The published TimetableSlot's period number this session was created
  // for - set once at creation from the active period, never faculty-edited.
  // Absent on sessions created before this field existed.
  periodNumber?: number;
  status: StudentAttendanceSessionStatus;
  entries: StudentAttendanceEntry[];
  totalStudents: number;
  presentCount: number;
  classNotes: string; // "Record of the Class Work" - what the faculty covered in this class session

  // Set only when this session was created/completed through the
  // Department Office correction flow (see /api/college/student-attendance/
  // office-correction) rather than the faculty's own live period-window
  // submission - i.e. the faculty didn't post within class hours, so an
  // HOD/DEPARTMENT_OFFICE login (DEPARTMENT_OFFICE normalizes to "HOD" for
  // auth - see UserRole's own doc-comment) posted or finished it afterward.
  // Absent (not "FACULTY") on every normal session - the common case.
  postedBy?: "OFFICE";
  correctedByUid?: string;
  correctedByName?: string;
  correctionReason?: string; // required by the office-correction route - why the faculty didn't post it themselves

  // Set only when `facultyId`/`facultyName` above are the COVERING faculty,
  // not the one this class was originally assigned to - i.e. posted by an
  // approved leave substitute (see resolveSubstituteSlotsForDate) rather
  // than the assignment's own facultyId. Absent on every ordinary session.
  substituteForFacultyId?: string;
  substituteForFacultyName?: string;

  submittedAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
