import type { Timestamp } from "firebase/firestore";

// ─── Late-attendance permission ───────────────────────────────────────────────
// doc path: colleges/{collegeId}/permissionRequests/{id}
//
// Someone arriving late (or stepping out for part of a day) asks their
// approver for permission. Deliberately NOT a leave type: LeaveTypeCode is a
// closed union whose every member carries a day balance and a row in the
// monthly register, and a permission is neither - it is a slice of one day,
// counted in hours, that never touches a balance. Keeping it separate leaves
// the leave register exactly as it was.
//
// What it DOES reuse is the routing: the same resolveApproverStage that
// decides where a leave request goes (approvalRouting.ts), so a faculty
// member's permission reaches their HOD and an HOD's reaches the Principal,
// honouring whatever the college has configured - rather than a second,
// parallel idea of who approves whom that could drift out of step.

export type PermissionRequestStatus =
  | "PENDING_HOD"
  | "PENDING_PRINCIPAL"
  // See LeaveRequestStatus's own PENDING_VICE_PRINCIPAL comment (types/leave.ts) -
  // same split, same reasoning, kept in step per this file's own header comment.
  | "PENDING_VICE_PRINCIPAL"
  | "PENDING_MANAGEMENT"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export const PERMISSION_STATUS_LABELS: Record<PermissionRequestStatus, string> = {
  PENDING_HOD: "Pending HOD",
  PENDING_PRINCIPAL: "Pending Principal",
  PENDING_VICE_PRINCIPAL: "Pending Vice Principal",
  PENDING_MANAGEMENT: "Pending Management",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export const PENDING_PERMISSION_STATUSES: PermissionRequestStatus[] = [
  "PENDING_HOD",
  "PENDING_PRINCIPAL",
  "PENDING_VICE_PRINCIPAL",
  "PENDING_MANAGEMENT",
];

export interface PermissionRequest {
  id: string;
  collegeId: string;

  // Requester
  uid: string;
  employeeName: string;
  employeeId?: string;
  department?: string;
  role: string;

  /** The day being asked about, stored as yyyy-mm-dd rather than a Timestamp:
   *  a permission is always one local calendar day, and a date-only string
   *  can't drift across a timezone the way a midnight Timestamp can. */
  date: string;
  /** 24h HH:mm. `fromTime` is when they expect to arrive (or leave). */
  fromTime: string;
  toTime: string;
  /** Derived at write time from the two above, so lists and approvals don't
   *  each re-parse the clock. */
  minutes: number;

  reason: string;

  status: PermissionRequestStatus;
  /** Which tier this was routed to when raised - kept so the approval guard
   *  doesn't have to re-derive it from a routing map that may have changed
   *  since. */
  approverStage: "HOD" | "PRINCIPAL" | "VICE_PRINCIPAL" | "MANAGEMENT";

  decidedByUid?: string;
  decidedByName?: string;
  decidedAt?: Timestamp;
  decisionNote?: string;

  createdAt: Timestamp;
  updatedAt?: Timestamp;
}
