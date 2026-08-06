import type { Timestamp } from "firebase/firestore";

// ─── Subject ──────────────────────────────────────────────────────────────────

export type SubjectType = "THEORY" | "PRACTICAL" | "TUTORIAL" | "PROJECT";

export const SUBJECT_TYPE_LABELS: Record<SubjectType, string> = {
  THEORY: "Theory",
  PRACTICAL: "Practical / Lab",
  TUTORIAL: "Tutorial",
  PROJECT: "Project",
};

// Two independent shapes share this collection (see api/college/subjects/route.ts):
// course/year-scoped (departmentId/courseId/year set) and semester-scoped
// (semester set, no course link).
export interface Subject {
  id: string;
  collegeId: string;
  department: string;
  departmentId?: string;
  courseId?: string;
  courseName?: string;
  year?: number;               // academic year within the course (1..course.durationYears) — common to all sections of that year
  semester?: number;           // semester-scoped subjects only
  name: string;
  code: string;
  hoursPerWeek: number;
  totalHoursPerSemester?: number;
  credits: number;
  type: SubjectType;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Teaching Assignment ──────────────────────────────────────────────────────
// Links a faculty member to a subject. Two independent shapes share this collection
// (see api/college/teaching-assignments/route.ts): course/section-scoped (courseId +
// sectionId set) and semester-scoped (academicYear + semester set, no section link).

export interface TeachingAssignment {
  id: string;
  collegeId: string;
  facultyId: string;
  facultyName: string;
  department: string;
  departmentId?: string;
  courseId?: string;
  courseName?: string;
  year?: number;                 // academic year within the course — course/section-scoped only
  sectionId?: string;
  sectionName?: string;
  academicYear?: string;         // semester-scoped only
  semester?: number;             // semester-scoped only
  section?: string;              // semester-scoped only (free-text, unlike sectionId)
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  hoursPerWeek: number;
  totalHoursAllotted?: number;
  assignedBy: string;
  assignedByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;

  // Course/section-scoped rows only — every such row (current or past) carries
  // which academic year/semester it belongs to, for the resume/Teaching Load
  // table. Named distinctly from `academicYear`/`semester` above (which belong to
  // the independent semester-scoped shape this collection also stores, and are
  // typed differently — semester there is a number) to keep the two shapes
  // unambiguous. `isPast` additionally marks a historical assignment (no weekly
  // schedule/timetable slots), which is the only thing that unlocks `passPercentage`.
  isPast?: boolean;
  assignmentAcademicYear?: string;
  assignmentSemester?: string;
  passPercentage?: number;
  studentFeedback?: number;   // average student feedback rating for this teaching period, as a %
}

// ─── Timetable Slot ───────────────────────────────────────────────────────────

export type DayOfWeek = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT";

export const DAY_LABELS: Record<DayOfWeek, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
};

export interface TimetableSlot {
  id: string;
  collegeId: string;
  department: string;
  assignmentId: string;
  facultyId: string;
  facultyName: string;
  courseId: string;
  year: number;
  sectionId: string;
  subjectId: string;
  subjectName: string;
  day: DayOfWeek;
  periodNumber: number;         // resolved against that course-year's CourseYearTiming for clock time
  classroom?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Internal Marks ───────────────────────────────────────────────────────────
// A faculty's internal-assessment marks for their own students, scoped to a
// (section, subject) they actively teach per TeachingAssignment. `examType` is
// picked explicitly by the faculty at entry time (independent of the subject's
// own SubjectType) since a single subject can carry both a theory and a lab
// internal. Doc id is deterministic —
// `${sectionId}_${subjectId}_${examType}_${assessmentName}_${studentId}` — so
// re-saving the same assessment upserts instead of duplicating rows.
// `department`/`facultyName` are denormalized from the TeachingAssignment at
// write time so the HOD oversight view can query/display without extra joins.

export type ExamType = "THEORY" | "LAB";

export const EXAM_TYPE_LABELS: Record<ExamType, string> = {
  THEORY: "Theory",
  LAB: "Lab",
};

export interface InternalMark {
  id: string;
  collegeId: string;
  department: string;
  facultyId: string;
  facultyName: string;
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  studentId: string;
  studentName: string;
  rollNumber: string;
  examType: ExamType;
  assessmentName: string;   // e.g. "IA1", "IA2", "Assignment 1"
  maxMarks: number;
  marksObtained: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Workload Summary ─────────────────────────────────────────────────────────
// Computed aggregate of total hours assigned per faculty per semester

export interface WorkloadSummary {
  id: string;                   // `${facultyId}_${academicYear}_${semester}`
  collegeId: string;
  facultyId: string;
  facultyName: string;
  department: string;
  academicYear: string;
  semester: number;
  totalHoursPerWeek: number;
  theoryHours: number;
  practicalHours: number;
  tutorialHours: number;
  subjectCount: number;
  updatedAt: Timestamp;
}
