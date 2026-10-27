import type { ApprovalRequest, KindConfig } from "@/lib/approvals";
import type { StageId } from "@/lib/approvals";

export const PERMISSION_KIND = "STUDENT_PERMISSION";

export type PermissionRequesterType = "STUDENT" | "FACULTY";
export type PermissionStage = "CLASS_INCHARGE" | "DELEGATED_FACULTY" | "HOD" | "VICE_PRINCIPAL" | "PRINCIPAL";

export const PERMISSION_STAGE_LABELS: Record<PermissionStage, string> = {
  CLASS_INCHARGE: "Class Incharge", DELEGATED_FACULTY: "Designated Faculty", HOD: "Head of Department", VICE_PRINCIPAL: "Vice Principal", PRINCIPAL: "Principal",
};

/** Stages a route may use, per who raised the request. A class incharge only makes sense for one student's own request. */
export function allowedStages(requesterType: string): PermissionStage[] {
  return requesterType === "STUDENT"
    ? ["CLASS_INCHARGE", "DELEGATED_FACULTY", "HOD", "VICE_PRINCIPAL", "PRINCIPAL"]
    : ["DELEGATED_FACULTY", "HOD", "VICE_PRINCIPAL", "PRINCIPAL"];
}

/** Used until the Principal (or a delegated HOD) configures something else. */
export const defaultRoute = (_requesterType: string): StageId[] => ["HOD"];

export interface PermissionLimits extends Record<string, unknown> {
  /** Longest a single request may run, in calendar days. */
  maxDays: number;
  /** Must a request carry at least one proof document? */
  proofRequired: boolean;
  /** Per permission type (a category id or a group id): is proof required? Beats `proofRequired`; see resolveProofRequired. */
  proofByType?: Record<string, boolean>;
  /** Per permission type: the roles that may raise it (see REQUESTER_ROLES). Absent = anyone who can raise requests. */
  requestersByType?: Record<string, string[]>;
  /** Preferred notice before the first day. Advisory: a shorter one is flagged "late", not refused. */
  advanceNoticeHours: number;
  maxStudentsPerRequest: number;
  /** How many days before today a request may start. Past days are real attendance already taken, so this stays short. */
  maxBackdateDays: number;
}

export const DEFAULT_LIMITS: PermissionLimits = { maxDays: 15, proofRequired: true, advanceNoticeHours: 24, maxStudentsPerRequest: 100, maxBackdateDays: 7 };

export type PermissionConfig = KindConfig<PermissionLimits>;

/** The student a request covers - denormalised so listings and effects need no joins. */
export interface PermissionStudentRef {
  id: string;
  /** The student's login uid, when they have one - so they can be told the outcome. */
  uid?: string;
  rollNumber: string;
  name: string;
  department: string;
  year: number;
  section: string;
}

export interface PermissionProof { url: string; name: string }

export interface PermissionPayload {
  categoryId: string;
  groupId: string;
  categoryLabel: string;
  otherCategory?: string;
  title: string;
  description: string;
  venue?: string;
  fromDate: string; // YYYY-MM-DD (IST)
  toDate: string;
  /** "ALL" = every period on each covered day; otherwise just these period numbers. */
  periods: "ALL" | number[];
  /** The class days in [fromDate, toDate] (holidays / Sundays removed) - what attendance is marked for. */
  coverageDates: string[];
  students: PermissionStudentRef[];
  /** Login uids of the students that have one - an indexable copy so "requests covering me" is one query. */
  studentUids: string[];
  proof: PermissionProof[];
  /** Raised with less than the preferred notice (advisory). */
  late: boolean;
  noticeHours: number;
  /** Class incharge (Section.facultyInchargeUid) for a single-student request, when one is assigned. */
  inchargeUid?: string;
  /** Designated faculty UID for delegated approval stage if configured. */
  delegatedFacultyUid?: string;
  delegatedFacultyName?: string;
}

/** The login performing an action, with its CURRENT roles (primary + seats). */
export interface ActingUser { uid: string; name: string; collegeId: string; roles: readonly string[] }
export type PermissionRequest = ApprovalRequest<PermissionPayload>;

/** Approvals-engine context: who is acting, with which roles. */
export interface PermissionContext {
  db: FirebaseFirestore.Firestore;
  collegeId: string;
  /** Roles the acting login holds (primary + seats). */
  actorRoles: readonly string[];
}
