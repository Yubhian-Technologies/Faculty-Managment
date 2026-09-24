import type { Timestamp } from "firebase/firestore";
import type { UserRole } from "./core";

// ─── Circular Module — highly decoupled, SOLID ────────────────────────────
// Single Responsibility: this file defines DATA SHAPES ONLY. No logic.
// Open/Closed: new employee types / statuses via union extension, no edit.
// Liskov: discriminated unions (EmployeeScope) substitutable.
// Interface Segregation: small interfaces (CircularAudience, CircularAttachment).
// Dependency Inversion: services depend on these abstractions, not concrete UI.

export type EmployeeScope = "TEACHING" | "NON_TEACHING" | "ALL";
export const EMPLOYEE_SCOPE_LABELS: Record<EmployeeScope, string> = {
  TEACHING: "Teaching",
  NON_TEACHING: "Non-Teaching",
  ALL: "All",
};

export type CircularStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export const CIRCULAR_STATUS_LABELS: Record<CircularStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

// Who the circular is FROM — principal configures options in settings.
// Stored as free text (display value) to allow any dynamic value the principal sets,
// but defaults are provided for bootstrapping.
export type CircularMessageFrom = string;
export const DEFAULT_MESSAGE_FROM_OPTIONS: CircularMessageFrom[] = ["Management", "Principal", "Dean", "HOD"];

export interface CircularAudience {
  employeeType: EmployeeScope; // teaching / non-teaching / all
  departmentIds: string[]; // [] = all departments in college
  departmentNames?: string[]; // denormalized for display
}

export interface CircularAttachment {
  fileName: string;
  fileUrl: string; // Firebase Storage download URL
  fileType?: string; // e.g. application/pdf
  fileSize?: number; // bytes
}

// Core entity — one Firestore doc at colleges/{collegeId}/circulars/{id}
export interface Circular {
  id: string;
  collegeId: string;
  subject: string;
  body: string; // rich text / plain text body (message)
  date: Timestamp; // circular date (IST day the circular is dated)
  audience: CircularAudience;
  messageFrom: CircularMessageFrom;
  attachments: CircularAttachment[]; // usually 0–1, array for extensibility
  status: CircularStatus;
  createdBy: string; // uid
  createdByName: string;
  createdByRole: UserRole;
  publishedAt?: Timestamp | null;
  publishedBy?: string | null;
  publishedByName?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Settings — one doc per college at colleges/{collegeId}/settings/circularSettings
export interface CircularSettings {
  collegeId: string;
  messageFromOptions: CircularMessageFrom[]; // principal-managed, defaults above
  updatedAt: Timestamp;
  updatedBy?: string;
  updatedByName?: string;
}

// RBAC — who may SEND (create/publish) circulars.
// Principal grants per-user or per-role. Evaluated in requireCanSendCircular().
export interface CircularPermission {
  id: string;
  collegeId: string;
  grantedToUid?: string; // specific user (HOD uid or PANEL_MEMBER uid)
  grantedToRole?: UserRole; // e.g. HOD as a whole
  grantedToDepartment?: string; // optional scope narrowing
  grantedBy: string;
  grantedByName: string;
  createdAt: Timestamp;
}

// Aggregated doc at colleges/{collegeId}/settings/circularPermissions (single doc)
// Simpler than per-row collection for this module's scale.
export interface CircularPermissionsDoc {
  collegeId: string;
  allowedUids: string[]; // explicit users enabled by principal
  allowedRoles: UserRole[]; // roles enabled (e.g. ["HOD"])
  // Optional: per-department HOD grant — if present, only that department's HODs are enabled
  allowedDepartmentIds?: string[];
  updatedAt: Timestamp;
  updatedBy?: string;
  updatedByName?: string;
}
