import type { Timestamp } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// Leave Module - from-scratch rebuild.
//
// Three leave profiles:
//  - "vacation"      (teaching faculty)     -> CL, SL, SCL, EL, OD (+ Other)
//  - "non-vacation"  (technical/non-technical supporting staff) -> CL, SL, EL, OD (+ Other)
//  - "new-joining"   (anyone, regardless of teaching status, until they cross
//                     the college's configured years-of-service threshold)
//                     -> CL, OD only
//
// "new-joining" is never stored - it's computed live from
// (years since EmployeeLeaveProfile.dateOfJoining) vs the college's
// newJoiningYears setting (see computeEffectiveCategory in lib/leave/categoryEngine).
// The moment the threshold is crossed, the profile's stored staffCategory
// (vacation/non-vacation) takes over automatically.
//
// "Other" is not a balance-tracked leave type - it's a catch-all reason a
// requester picks when none of the above fit; the approving HOD assigns the
// actual leaveTypeCode to sanction it against (see LeaveRequest.isOtherRequest).
//
// Collections: root `leaveTypes`, colleges/{id}/employeeLeaveProfiles,
//              colleges/{id}/leaveBalances, colleges/{id}/leaveRequests
// ─────────────────────────────────────────────────────────────────────────────

export type LeaveTypeCode = "CL" | "SL" | "SCL" | "EL" | "OD";

export const LEAVE_TYPE_LABELS: Record<LeaveTypeCode, string> = {
  CL: "Casual Leave",
  SL: "Sick Leave",
  SCL: "Special Casual Leave",
  EL: "Earned Leave",
  OD: "On Duty",
};

export type StaffCategory = "vacation" | "non-vacation";
export type EffectiveLeaveCategory = "new-joining" | StaffCategory;

export const EFFECTIVE_CATEGORY_LABELS: Record<EffectiveLeaveCategory, string> = {
  "new-joining": "New Joining",
  vacation: "Vacation Staff (Teaching)",
  "non-vacation": "Non-Vacation Staff (Supporting)",
};

export interface LeaveTypeRules {
  daysPerYear?: number;   // undefined when unlimited is true
  unlimited?: boolean;    // OD only - no balance is tracked, history is shown instead
  eligibleCategories: EffectiveLeaveCategory[];
}

export interface LeaveTypeFull {
  id: string;
  code: LeaveTypeCode;
  label: string;
  shortLabel: string;
  color: string;
  isActive: boolean;
  sortOrder: number;
  rules: LeaveTypeRules;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Employee Leave Profile ───────────────────────────────────────────────────
// doc path: colleges/{collegeId}/employeeLeaveProfiles/{uid}
// Auto-created on first balance/profile lookup from FacultyMember defaults
// (see /api/leave/profile) - HOD/Principal can override via the profile edit page.

export interface EmployeeLeaveProfile {
  id: string; // == uid
  collegeId: string;
  uid: string;
  staffCategory: StaffCategory; // the category this person converts INTO once past new-joining
  isTeachingStaff: boolean;
  dateOfJoining: Timestamp;
  department?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Leave Balance ─────────────────────────────────────────────────────────────
// doc path: colleges/{collegeId}/leaveBalances/{uid}_{leaveTypeCode}_{year}
// Never created for OD (unlimited - no balance doc).

export interface LeaveBalance {
  id: string;
  collegeId: string;
  uid: string;
  leaveTypeCode: LeaveTypeCode;
  year: number;
  entitled: number;
  used: number;
  pending: number;
  updatedAt: Timestamp;
}

// ─── Leave Request ─────────────────────────────────────────────────────────────
// doc path: colleges/{collegeId}/leaveRequests/{id}

export type LeaveRequestStatus =
  | "PENDING_HOD"
  | "PENDING_PRINCIPAL"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export const LEAVE_REQUEST_STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  PENDING_HOD: "Pending HOD",
  PENDING_PRINCIPAL: "Pending Principal",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export interface LeaveActionRecord {
  action: "APPROVED" | "REJECTED";
  by: string;
  byName: string;
  at: Timestamp;
  remarks?: string;
  // Set by the HOD when acting on an isOtherRequest - the leave type it's
  // actually sanctioned against (defaults leaveTypeCode on approval).
  assignedLeaveTypeCode?: LeaveTypeCode;
}

export interface LeaveRequest {
  id: string;
  collegeId: string;
  uid: string;
  employeeName: string;
  department?: string;
  // Undefined only while isOtherRequest is true and no one has assigned the
  // real type yet.
  leaveTypeCode?: LeaveTypeCode;
  isOtherRequest?: boolean;
  fromDate: Timestamp;
  toDate: Timestamp;
  totalDays: number;
  isHalfDay?: boolean;
  reason: string;
  status: LeaveRequestStatus;
  hodAction?: LeaveActionRecord;
  principalAction?: LeaveActionRecord;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
