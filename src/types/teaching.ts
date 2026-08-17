import type { Timestamp } from "firebase/firestore";

// ─── Subject ──────────────────────────────────────────────────────────────────

export type SubjectType = "THEORY" | "PRACTICAL" | "TUTORIAL" | "PROJECT";

export const SUBJECT_TYPE_LABELS: Record<SubjectType, string> = {
  THEORY: "Theory",
  PRACTICAL: "Practical / Lab",
  TUTORIAL: "Tutorial",
  PROJECT: "Project",
};

// Standard AICTE model-curriculum categories, used across most Indian
// engineering colleges' L-T-P-C curriculum tables.
export type SubjectCategory = "HSMC" | "BSC" | "ESC" | "PCC" | "PEC" | "OEC" | "MC" | "PROJ";

export const SUBJECT_CATEGORY_LABELS: Record<SubjectCategory, string> = {
  HSMC: "Humanities & Social Sciences (HSMC)",
  BSC: "Basic Science (BSC)",
  ESC: "Engineering Science (ESC)",
  PCC: "Professional Core (PCC)",
  PEC: "Professional Elective (PEC)",
  OEC: "Open Elective (OEC)",
  MC: "Mandatory Courses (MC)",
  PROJ: "Project / Seminar / Internship (PROJ)",
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
  year?: number;               // academic year within the course (1..course.durationYears) - common to all sections of that year
  semester?: number;           // semester-scoped subjects only
  // The calendar academic session this subject entry belongs to (e.g.
  // "2026-27") - not the same as `year` above. Set by the Dean when creating
  // a subject (see dean/subjects/new/page.tsx); optional/absent on subjects
  // created before this field existed or via the HOD's own Subjects page.
  academicYear?: string;
  // The curriculum regulation this subject's syllabus follows (e.g. "R20",
  // "R23") - one of the college's declared AcademicRegulationSettings.regulations
  // (colleges/{collegeId}/settings/academicRegulations). Different batches of
  // the same year-of-study can be on different regulations at once (e.g. a
  // transition year), so this is set per-subject rather than inherited from
  // Settings' one-regulation-per-year default. Required for course/year-scoped
  // subjects going forward (enforced in POST); absent on semester-scoped
  // subjects (no course/year link to hang a regulation off of) and on subjects
  // created before this field existed, until backfilled - see
  // scripts/backfill-subject-regulations.mjs. Immutable once set (like
  // courseId/year) - not editable via PATCH.
  regulation?: string;
  // Row position in the Dean's curriculum-table view of a course/year -
  // editable, so the Dean can match a printed curriculum sheet's ordering
  // instead of being stuck with alphabetical-by-name. Course/year-scoped
  // subjects only; absent on legacy subjects created before this field
  // existed (those sort after any with a serialNumber, then by name).
  serialNumber?: number;
  // Curriculum category (e.g. Professional Core, Open Elective) - see
  // SUBJECT_CATEGORY_LABELS. Course/year-scoped subjects only.
  category?: SubjectCategory;
  name: string;
  code: string;
  hoursPerWeek: number;
  totalHoursPerSemester?: number;
  // L-T-P breakdown (Lecture/Tutorial/Practical hours per week) alongside
  // `hoursPerWeek` and `type` above - a single subject's weekly load is
  // often split across more than one of these (e.g. 3 lecture + 2 lab
  // hours), which neither hoursPerWeek nor the single-valued `type` capture
  // on their own. Course/year-scoped subjects only.
  lectureHours?: number;
  tutorialHours?: number;
  practicalHours?: number;
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
  year?: number;                 // academic year within the course - course/section-scoped only
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

  // Course/section-scoped rows only - every such row (current or past) carries
  // which academic year/semester it belongs to, for the resume/Teaching Load
  // table. Named distinctly from `academicYear`/`semester` above (which belong to
  // the independent semester-scoped shape this collection also stores, and are
  // typed differently - semester there is a number) to keep the two shapes
  // unambiguous. `isPast` additionally marks a historical assignment (no weekly
  // schedule/timetable slots), which is the only thing that unlocks `passPercentage`.
  isPast?: boolean;
  assignmentAcademicYear?: string;
  assignmentSemester?: string;
  passPercentage?: number;
  studentFeedback?: number;   // average student feedback rating for this teaching period, as a %
}

// ─── Faculty Assignment Request ────────────────────────────────────────────────
// When an HOD's own/managed/feeder faculty pool has nobody free for a subject on
// one of their sections, they can ask a different, unrelated department to lend
// a faculty member instead of assigning one directly (see college/
// faculty-assignment-requests/route.ts). The target department's HOD picks one
// of their own faculty to fulfill it, which creates the actual TeachingAssignment
// (still filed under the requesting section's own department) - periods for it
// are then picked the normal way, via the Timetable page's "Add a subject".

export type FacultyAssignmentRequestStatus = "PENDING" | "ALLOCATED" | "DECLINED";

export interface FacultyAssignmentRequest {
  id: string;
  collegeId: string;
  courseId: string;
  courseName: string;
  year: number;
  sectionId: string;
  sectionName: string;
  requestingDepartment: string;   // the section's own department - who this request is for
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  hoursPerWeek: number;
  targetDepartmentId: string;     // the department being asked to lend a faculty member
  targetDepartmentName: string;
  requestedBy: string;            // uid
  requestedByName: string;
  status: FacultyAssignmentRequestStatus;
  allocatedFacultyId?: string;
  allocatedFacultyName?: string;
  allocatedBy?: string;           // uid of the target department's HOD who fulfilled it
  teachingAssignmentId?: string;  // the TeachingAssignment created once allocated
  declineReason?: string;
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

// How a slot got here. MANUAL slots come from the per-faculty "Weekly Schedule"
// grid in TeachingAssignmentsEditor and are treated as PINNED: the generator
// schedules around them and publishing never deletes them. GENERATED slots are
// produced by the solver and are replaced wholesale on each publish.
export type TimetableSlotSource = "MANUAL" | "GENERATED";

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
  source?: TimetableSlotSource; // absent on rows written before this field existed - treat as MANUAL
  isPinned?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;

  // Attached at read time only (never persisted on the doc itself) when
  // today has an APPROVED leave's PeriodSubstitution covering this exact
  // slot - see lib/leave/periodCoverage.ts's getActiveSubstitutionsForDate,
  // applied by GET college/timetable-slots, college/class-leader/timetable,
  // and college/teaching-assignments. Absent on every other day, and absent
  // for a slot nobody's covering today even if `day` matches today.
  substituteFacultyId?: string;
  substituteFacultyName?: string;
  substituteForName?: string; // the regularly-scheduled faculty's name, on leave today
}

// ─── Timetable Rules ──────────────────────────────────────────────────────────
// Per-college scheduling constraints, stored at
// colleges/{collegeId}/settings/timetableRules. Rules differ college to college,
// so nothing here is hard-coded in the solver - DEFAULT_TIMETABLE_RULES is only
// the starting point shown before anyone configures them.
//
// The first four are HARD constraints: the solver fails (with diagnostics)
// rather than violate them. The `prefer*` flags are soft - used only to rank
// otherwise-valid placements.

export interface TimetableRules {
  workingDays: DayOfWeek[];
  /** Hard cap on periods a single faculty may teach in one day. */
  maxPeriodsPerFacultyPerDay: number;
  /** Hard cap on back-to-back periods for one faculty, across all sections. */
  maxConsecutivePeriodsPerFaculty: number;
  /** Hard cap on how often one subject may repeat in a day for a section. */
  maxPeriodsPerSubjectPerDay: number;
  /** Contiguous periods a PRACTICAL subject occupies (e.g. a 3-hour lab). */
  labBlockSize: number;
  /** When false, a lab block may not straddle lunch or a short break. */
  allowLabAcrossBreaks: boolean;
  // Soft preferences
  preferTheoryInMorning: boolean;
  spreadSubjectsAcrossWeek: boolean;
  updatedAt?: Timestamp;
  updatedByName?: string;
}

export const DEFAULT_TIMETABLE_RULES: TimetableRules = {
  workingDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
  maxPeriodsPerFacultyPerDay: 4,
  maxConsecutivePeriodsPerFaculty: 3,
  maxPeriodsPerSubjectPerDay: 1,
  labBlockSize: 3,
  allowLabAcrossBreaks: false,
  preferTheoryInMorning: true,
  spreadSubjectsAcrossWeek: true,
};

// ─── Timetable Draft ──────────────────────────────────────────────────────────
// doc path: colleges/{collegeId}/timetableDrafts/{sectionId}
//
// Drafts deliberately live OUTSIDE the `timetableSlots` collection. The Class
// Leader route (api/college/class-leader/timetable) and the faculty view
// (panel/teaching) read timetableSlots directly with no published/unpublished
// filter, so writing a draft there would expose a half-finished timetable to
// students and faculty the moment it is generated. Only `publish` materialises
// a draft into timetableSlots.

export type TimetableDraftStatus = "DRAFT" | "PUBLISHED";

/** A proposed placement. Mirrors the fields of TimetableSlot needed to
 *  materialise one, without the server-assigned id/timestamps. */
export interface DraftSlot {
  assignmentId: string;
  facultyId: string;
  facultyName: string;
  subjectId: string;
  subjectName: string;
  subjectType: SubjectType;
  day: DayOfWeek;
  periodNumber: number;
  /** True for the 2nd..Nth period of a lab block - kept together when moved. */
  isBlockContinuation?: boolean;
}

export interface TimetableDraft {
  id: string;            // == sectionId
  collegeId: string;
  department: string;
  courseId: string;
  year: number;
  sectionId: string;
  sectionName: string;
  status: TimetableDraftStatus;
  slots: DraftSlot[];
  /** Human-readable notes from the solver - why it failed, or what it relaxed. */
  diagnostics: string[];
  generatedAt: Timestamp;
  generatedByName: string;
  publishedAt?: Timestamp;
  publishedByName?: string;
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
