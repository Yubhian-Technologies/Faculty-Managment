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
// requester picks when none of the above fit. The HOD tags it paid/unpaid
// (LeaveRequest.isPaidLeave) and forwards it to the Principal for the final
// decision, instead of approving/rejecting it directly (see
// LeaveRequest.isOtherRequest). Standard types (CL/SL/SCL/EL/OD), by
// contrast, are decided by the HOD alone - approval there is final.
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

// Display order for the category tab strip shared by the Leave History
// register and the Leave Approvals queue.
export const EFFECTIVE_CATEGORY_ORDER: EffectiveLeaveCategory[] = ["new-joining", "vacation", "non-vacation"];

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
  // Earned Leave only - the previous year's unused EL already folded into
  // `entitled` above (see initBalancesForYear's carry-forward step), kept
  // separately so the EL history view can show the "6 base + 3 carried" split
  // rather than just the combined total.
  carriedForward?: number;
  updatedAt: Timestamp;
}

// ─── Leave Request ─────────────────────────────────────────────────────────────
// doc path: colleges/{collegeId}/leaveRequests/{id}
//
// A PANEL_MEMBER's request always starts at PENDING_HOD. From there:
//  - Standard types (CL/SL/SCL/EL/OD): the HOD's decision is final - APPROVE
//    commits the balance and closes the request; REJECT releases it. Never
//    reaches PENDING_PRINCIPAL. Insufficient balance never blocks approval -
//    days beyond what's remaining are accepted and recorded as LeaveRequest.lopDays
//    (Loss of Pay) instead of being committed to the balance.
//  - "Other" requests (isOtherRequest): the HOD can REJECT outright, or tag
//    isPaidLeave and forward to PENDING_PRINCIPAL, where the Principal/VP
//    gives the final APPROVE/REJECT (balance-exempt either way).
// Non-PANEL_MEMBER submitters (HOD/Vice Principal/etc.'s own leave) skip the
// HOD stage entirely and start at PENDING_PRINCIPAL, unchanged from before -
// approvable by the Principal (a Vice Principal can't approve their own, see
// applications/[id]/route.ts). A PRINCIPAL's own leave instead starts at
// PENDING_MANAGEMENT, decided by the global MANAGEMENT role (see
// api/management/leave-approvals) since there's no one above the Principal
// within the college itself.

export type LeaveRequestStatus =
  | "PENDING_HOD"
  | "PENDING_PRINCIPAL"
  | "PENDING_MANAGEMENT"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export const LEAVE_REQUEST_STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  PENDING_HOD: "Pending HOD",
  PENDING_PRINCIPAL: "Pending Principal",
  PENDING_MANAGEMENT: "Pending Management",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

// The Principal/Vice Principal must pick one of these when approving an
// isOtherRequest at PENDING_PRINCIPAL - a further breakdown of "Other" for
// the Principal's own record-keeping. Deliberately NOT a field on
// LeaveRequest itself - it's kept in a separate collection
// (colleges/{collegeId}/otherLeaveCategories/{requestId}, see
// src/lib/leave/otherCategories.ts) that only the Principal-only
// staff-leave-history surface ever reads, so it never appears in the
// requester's own leave history, the HOD's queue/history, or the general
// approval queue - see api/leave/other-categories/route.ts.
export type OtherLeaveCategory = "MATERNITY" | "FAMILY_PLANNING" | "QUARANTINE" | "EXTRAORDINARY" | "COMPENSATORY";

export const OTHER_LEAVE_CATEGORY_LABELS: Record<OtherLeaveCategory, string> = {
  MATERNITY: "Maternity",
  FAMILY_PLANNING: "Family Planning",
  QUARANTINE: "Quarantine",
  EXTRAORDINARY: "Extraordinary",
  COMPENSATORY: "Compensatory",
};

export const OTHER_LEAVE_CATEGORY_ORDER: OtherLeaveCategory[] = [
  "MATERNITY", "FAMILY_PLANNING", "QUARANTINE", "EXTRAORDINARY", "COMPENSATORY",
];

export interface LeaveActionRecord {
  action: "APPROVED" | "REJECTED";
  by: string;
  byName: string;
  at: Timestamp;
  remarks?: string;
  // Set by the HOD when acting on an isOtherRequest - the leave type it's
  // actually sanctioned against (defaults leaveTypeCode on approval).
  assignedLeaveTypeCode?: LeaveTypeCode;
  // Set by the HOD when forwarding an isOtherRequest to the Principal - not
  // balance-tracked, just a record of how the HOD classified it.
  isPaidLeave?: boolean;
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
  // Which half of the day - only meaningful when isHalfDay is true. Purely
  // informational (doesn't affect countWorkingDays' flat 0.5, see
  // dayCounter.ts) but required by the client whenever isHalfDay is set, so
  // the approver knows which half without asking.
  halfDaySession?: "FN" | "AN";
  reason: string;
  status: LeaveRequestStatus;
  // Set by the HOD when forwarding an isOtherRequest to the Principal - Other
  // requests are never balance-tracked, this is purely informational.
  isPaidLeave?: boolean;
  // Set at approval time for a standard type (CL/SL/SCL/EL) whose totalDays
  // exceeded the remaining balance - the excess is never blocked, it's
  // accepted and tracked here as Loss of Pay days instead (no balance touch
  // for these days). Undefined/0 when the whole request fit within balance.
  lopDays?: number;
  // Set when this request was submitted via the "Extend Leave" action on an
  // already-approved, currently-ongoing Sick Leave (still sick past the
  // originally approved return date) - id of that original request. Sick
  // Leave only - see LeaveProfileView.tsx / applications/route.ts POST. It's
  // a brand-new request in every other respect (own id, own approval chain -
  // same HOD/Principal/Management routing as any other request by this
  // person - own balance/LOP handling), this is purely informational so the
  // approver has context and the requester's history shows the link.
  extendsRequestId?: string;
  // Required from the requester whenever they cancel (see
  // applications/[id]/route.ts PATCH's CANCEL branch) - shown alongside the
  // cancelled request wherever the approver above them (HOD/Principal/VP/
  // Management) views this person's leave history, e.g. LeaveHistoryRow.
  cancelReason?: string;
  hodAction?: LeaveActionRecord;
  principalAction?: LeaveActionRecord;
  // Set when a PRINCIPAL's own leave (PENDING_MANAGEMENT) is decided - see
  // api/management/leave-approvals/[id]/route.ts.
  managementAction?: LeaveActionRecord;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  // Not stored on the document - computed from the requester's leave profile
  // at read time and attached only by the approvals-queue endpoint, for the
  // New Joining / Vacation / Non-Vacation tab split.
  category?: EffectiveLeaveCategory;
}
