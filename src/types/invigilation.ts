// ─── Exam invigilation ──────────────────────────────────────────────────────
// The Exam Cell assigns faculty to the duties of a Mid exam: invigilators per
// room, relievers and a special squad per session. Duties come from the Mid
// timetables (dates, session times, subjects) and the paired Exam Seating plans
// (rooms and students in them). Faculty are `facultyMembers`; availability is
// the teaching timetable, approved leave and their other duties. See
// lib/invigilation/* for the rules.

export type DutyCategory = "INVIGILATOR" | "RELIEVER" | "SQUAD";
export const DUTY_CATEGORIES: DutyCategory[] = ["INVIGILATOR", "RELIEVER", "SQUAD"];
export const DUTY_CATEGORY_LABELS: Record<DutyCategory, string> = {
  INVIGILATOR: "Exam Invigilator",
  RELIEVER: "Reliever",
  SQUAD: "Special Squad",
};

/** HARD = refused; WARN = allowed only with an override (reason + an approver); OFF = not checked. */
export type RuleMode = "HARD" | "WARN" | "OFF";

/** Duty limits for one designation (or the default for designations not listed). Blank = no limit. */
export interface DesignationLimit {
  designation: string; // the facultyMembers.designation value ("ASSISTANT_PROFESSOR" ...); "" = default
  perSchedule?: number | null;
  perDay?: number | null;
  byCategory?: Partial<Record<DutyCategory, number | null>>;
  mode: Exclude<RuleMode, "OFF">;
}

export interface InvigilationRules {
  /** Categories used in this schedule. */
  categories: Record<DutyCategory, boolean>;
  /** Invigilators per room: ceil(students / studentsPerInvigilator), at least minPerRoom, at most maxPerRoom. */
  studentsPerInvigilator: number;
  minPerRoom: number;
  maxPerRoom: number;
  /** Relievers per session: ceil(rooms in use / roomsPerReliever). */
  roomsPerReliever: number;
  /** Special squad members per session. */
  squadPerSession: number;
  /** Which categories count towards the workload and the limits. */
  countCategories: DutyCategory[];
  limits: DesignationLimit[];
  /** Teaching timetable: check it; the classes of the course + year writing that day don't count (suspended). */
  timetableCheck: boolean;
  suspendExamYearClasses: boolean;
  /** A faculty member with no live timetable at all: flag (needs an override), block, or treat as free. */
  missingTimetable: "WARN" | "HARD" | "ALLOW";
  /** Minutes kept free between two duties of one person (travel / handover). */
  bufferMinutes: number;
  /** Subject restriction: faculty teaching a subject being written in the room / session. */
  excludeCurrentSubjectFaculty: boolean;
  excludePastSubjectFaculty: boolean;
  /** Departments whose faculty may not invigilate (e.g. the branch writing) - "" none. */
  excludeDepartments: string[];
  /** Room repeats within the schedule. */
  sameRoomRule: RuleMode;
  consecutiveSameRoomRule: RuleMode;
  /** Exam Cell logins (uids) who may approve an override. */
  approverUids: string[];
}

export type InvigilationScheduleStatus = "ACTIVE" | "CLOSED";

// doc path: colleges/{collegeId}/invigilationSchedules/{id}
export interface InvigilationSchedule {
  id: string;
  collegeId: string;
  name: string;
  /** The Mid timetables (midExamPlans ids) it covers. */
  midPlanIds: string[];
  /** Their exam days, for display ("YYYY-MM-DD"). */
  days: string[];
  status: InvigilationScheduleStatus;
  rules: InvigilationRules;
  /** Sessions ("date|from-to") published to faculty. */
  publishedSessions: string[];
  createdBy: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/** One place duties are needed: a room in a session (invigilators) or a session (relievers / squad). Derived, never stored. */
export interface DutySlot {
  key: string; // `${date}|${from}-${to}` or `${date}|${from}-${to}|${roomId}`
  session: string; // `${date}|${from}-${to}`
  date: string;
  from: string;
  to: string;
  category: DutyCategory;
  roomId?: string;
  room?: string; // "Block A, Floor 2, Room 201"
  block?: string;
  students: number;
  required: number;
  /** What is written: subjects (ids + names), branches, course + year. */
  subjects: { id: string; code: string; name: string }[];
  groups: string[];
  courseYears: { courseIds: string[]; year: number; semester: number }[];
}

export type DutyStatus = "DRAFT" | "PUBLISHED" | "ACKNOWLEDGED" | "COMPLETED" | "CANCELLED" | "REASSIGNED";
export const ACTIVE_DUTY_STATUSES: DutyStatus[] = ["DRAFT", "PUBLISHED", "ACKNOWLEDGED", "COMPLETED"];

export interface DutyOverride { rule: string; message: string; reason: string; byUid: string; byName: string; at: string }
export interface DutyHistoryEntry { at: string; byUid: string; byName: string; action: string; note?: string }

// doc path: colleges/{collegeId}/invigilationDuties/{id}
export interface InvigilationDuty {
  id: string;
  collegeId: string;
  scheduleId: string;
  slotKey: string;
  session: string;
  date: string;
  from: string;
  to: string;
  category: DutyCategory;
  roomId?: string;
  room?: string;
  block?: string;
  facultyId: string;
  facultyUid?: string;
  employeeId: string;
  facultyName: string;
  department: string;
  designation: string;
  status: DutyStatus;
  /** When the holder was first told (published) - a duty never published stays the Exam Cell's. */
  publishedAt?: string;
  /** Reassignment: the duty this one replaced / the one that replaced it. */
  replaces?: string;
  replacedBy?: string;
  overrides: DutyOverride[];
  history: DutyHistoryEntry[];
  createdBy: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/** What one faculty member holds in a schedule - kept on a lock doc so every check reads one document. */
export interface DutyRef { dutyId: string; slotKey: string; date: string; from: string; to: string; category: DutyCategory; roomId?: string; status: DutyStatus }

// doc path: colleges/{collegeId}/invigilationFacultyLocks/{scheduleId}__{facultyId}
export interface FacultyDutyLock { scheduleId: string; facultyId: string; duties: DutyRef[]; updatedAt?: unknown }
