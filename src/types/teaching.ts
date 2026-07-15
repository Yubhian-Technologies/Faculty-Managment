import type { Timestamp } from "firebase/firestore";

// ─── Subject ──────────────────────────────────────────────────────────────────

export type SubjectType = "THEORY" | "PRACTICAL" | "TUTORIAL" | "PROJECT";

export const SUBJECT_TYPE_LABELS: Record<SubjectType, string> = {
  THEORY: "Theory",
  PRACTICAL: "Practical / Lab",
  TUTORIAL: "Tutorial",
  PROJECT: "Project",
};

export interface Subject {
  id: string;
  collegeId: string;
  department: string;
  departmentId: string;
  courseId: string;
  courseName?: string;
  year: number;               // academic year within the course (1..course.durationYears) — common to all sections of that year
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
// Links a faculty member to a subject for a specific course, year and section

export interface TeachingAssignment {
  id: string;
  collegeId: string;
  facultyId: string;
  facultyName: string;
  department: string;
  departmentId: string;
  courseId: string;
  courseName: string;
  year: number;                 // academic year within the course
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  hoursPerWeek: number;
  assignedBy: string;
  assignedByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
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
