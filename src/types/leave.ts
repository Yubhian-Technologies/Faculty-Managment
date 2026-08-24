import type { Timestamp } from "firebase/firestore";
import type { DayOfWeek } from "./teaching";

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

export type LeaveTypeCode = "CL" | "SL" | "SCL" | "EL" | "OD" | "SH";

export const LEAVE_TYPE_LABELS: Record<LeaveTypeCode, string> = {
  CL: "Casual Leave",
  SL: "Sick Leave",
  SCL: "Special Casual Leave",
  EL: "Earned Leave",
  OD: "On Duty",
  SH: "Summer Vacation",
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
  // Sits here, before PENDING_HOD/PRINCIPAL/MANAGEMENT, whenever the request
  // has any AdjustmentRequest (below) still unaccepted - the approver never
  // even sees it until every named substitute/handover person has accepted.
  // Skipped entirely (request starts straight at its normal first stage) when
  // there's nothing to accept - see applications/route.ts POST.
  | "PENDING_ACCEPTANCE"
  | "PENDING_HOD"
  | "PENDING_PRINCIPAL"
  | "PENDING_MANAGEMENT"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export const LEAVE_REQUEST_STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  PENDING_ACCEPTANCE: "Awaiting Acceptance",
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

// One- or two-line summary of each category's rule, shown under the picker
// once the Principal selects one (LeaveApprovalQueue) so the sanctioning
// limits are visible at the moment of the decision rather than looked up.
//
// Condensed from the college's own written leave policy. Informational only -
// nothing here is enforced, since these are all "Other" requests whose days
// are never balance-tracked; the durations are what the Principal is
// sanctioning against by hand.
export const OTHER_LEAVE_CATEGORY_DESCRIPTIONS: Record<OtherLeaveCategory, string> = {
  MATERNITY:
    "Married women employees with at least 1 year of regular service — 90 days on full pay.",
  FAMILY_PLANNING:
    "For Family Planning Operations — 6 days for male and 14 days for female employees.",
  QUARANTINE:
    "Ordered absence due to an infectious disease — maximum 21 days, medical certificate required.",
  EXTRAORDINARY:
    "Leave without pay when no other leave applies — 3 months, 6 months with a medical certificate (1 year service), 2 years for higher studies (3 years service). Needs Management approval.",
  COMPENSATORY:
    "5 days per year as compensatory leave for working on holidays with prior approval. Must be used in the same year and cannot be carried forward. Not applicable to paid duties like exams or EAMCET.",
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
  // Set by the HOD when forwarding an isOtherRequest to the Principal - not
  // balance-tracked, just a record of how the HOD classified it.
  isPaidLeave?: boolean;
}

// ─── Period Substitution ───────────────────────────────────────────────────
// Links a leave request to who covers a specific teaching period while the
// requester is out - one entry per (date, TimetableSlot) the requester would
// otherwise have taught. For standard types (CL/SL/SCL/EL/OD), the requester
// must name a substitute for every affected period at submission time
// (assignedBy: "APPLICANT") - see /api/leave/period-coverage and
// applications/route.ts POST. For an "Other" request, the requester never
// picks these; instead the HOD may optionally assign some/all of them
// (assignedBy: "HOD") when tagging paid/unpaid and forwarding to the
// Principal - see applications/[id]/route.ts PATCH. Either way, substitutes
// are only notified once the request reaches a final APPROVED status (see
// notifySubstitutes in lib/leave/periodCoverage.ts) - never on a tentative
// pick or a forward that might still be rejected.
export interface PeriodSubstitution {
  date: string; // "YYYY-MM-DD" - the specific calendar date within the leave range
  day: DayOfWeek;
  periodNumber: number;
  timetableSlotId: string;
  sectionId: string;
  sectionName?: string;
  courseId?: string;
  subjectId: string;
  subjectName: string;
  substituteFacultyId: string;   // FacultyMember doc id, not the login uid
  substituteFacultyName: string;
  assignedBy: "APPLICANT" | "HOD";
}

// ─── Adjustment Requests (substitute / handover consent) ──────────────────
// Before this existed, a requester's/HOD's substitute picks (PeriodSubstitution
// above) and any handover pick (LeaveRequest.handoverToUid below) took effect
// directly - the named person was just notified once the leave was already
// APPROVED (see notifySubstitutes in periodCoverage.ts), never asked first.
// Now each named person must explicitly accept before the request can even
// reach the HOD/Principal/Management approver - see PENDING_ACCEPTANCE above,
// buildAdjustmentRequests in lib/leave/adjustmentRequests.ts (submission time),
// and /api/leave/applications/[id]/adjustment-response (their accept/decline).
// One entry per DISTINCT assignee, not per period - a substitute covering
// several of the requester's periods within one leave still gets a single
// combined notification, not one per period. Within that one entry, though,
// a SUBSTITUTE assignee can accept some periods and decline others (see
// `periods` below) rather than an all-or-nothing bundle - e.g. free for 4 of
// the 5 classes they were asked to cover, just not the 5th.
export type AdjustmentKind = "SUBSTITUTE" | "HANDOVER";
export type AdjustmentResponseStatus = "PENDING" | "ACCEPTED" | "DECLINED";

export interface AdjustmentPeriodStatus {
  date: string;
  timetableSlotId: string;
  status: AdjustmentResponseStatus;
}

export interface AdjustmentRequest {
  kind: AdjustmentKind;
  assigneeUid: string;
  assigneeName: string;
  // SUBSTITUTE only - the FacultyMember doc id this entry's assigneeUid
  // resolved from, so a decline can be traced back to which
  // PeriodSubstitution entries (keyed by substituteFacultyId, not uid) need
  // reassigning - see the REVISE_ADJUSTMENT action in applications/[id]/route.ts.
  assigneeFacultyId?: string;
  // SUBSTITUTE only - one row per period this assignee was asked to cover,
  // each independently PENDING/ACCEPTED/DECLINED (see
  // /api/leave/applications/[id]/adjustment-response's PARTIAL response).
  // Undefined for HANDOVER - there's nothing to split, see `status` below.
  periods?: AdjustmentPeriodStatus[];
  // The single source of truth for HANDOVER. For SUBSTITUTE it's DERIVED
  // from `periods` and kept in sync on every response: PENDING while any
  // period is still PENDING, ACCEPTED once every period is ACCEPTED,
  // DECLINED once every period is settled but at least one is DECLINED
  // (still blocks the request at PENDING_ACCEPTANCE until the requester
  // reassigns just those - see allAdjustmentsAccepted in
  // lib/leave/adjustmentRequests.ts).
  status: AdjustmentResponseStatus;
  respondedAt?: Timestamp;
  declineReason?: string;
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
  // System-generated: set on the auto-created, auto-APPROVED CL request a
  // late check-in penalty creates (see lib/leave/lateAttendancePenalty.ts) -
  // every 3rd late check-in in a calendar year deducts 0.5 Casual Leave.
  // Distinguishes it from a real request so it can't be cancelled (see
  // applications/[id]/route.ts's CANCEL branch and isCancellable() in
  // LeaveProfileView.tsx) - cancelling it would hand the days back for
  // nothing the requester did.
  isLateAttendancePenalty?: boolean;
  // Which of the requester's own teaching periods are covered while they're
  // out, and by whom - see PeriodSubstitution above. Undefined/empty for a
  // non-teaching requester, a leave range with no affected periods, or an
  // "Other" request the HOD chose not to adjust.
  periodSubstitutions?: PeriodSubstitution[];
  // A HOD/Principal-proposed CHANGE to one or more periods above - e.g.
  // overriding a pick while approving, or revisiting an already-APPROVED
  // leave after the timetable added a new period (see PROPOSE_COVERAGE in
  // applications/[id]/route.ts). Holds only the proposed subset, not a full
  // copy of periodSubstitutions. Each entry here has a matching PENDING
  // AdjustmentRequest (below) - once that new person accepts, the entry
  // moves from here into periodSubstitutions for real (see
  // /api/leave/applications/[id]/adjustment-response); if declined, it's
  // dropped here and the HOD/Principal must propose someone else. A standard
  // request's APPROVE (and an "Other" request's HOD forward) is blocked
  // while anything remains here - see PENDING_HOD's stage guard.
  pendingPeriodSubstitutions?: PeriodSubstitution[];
  // Optional, for EVERY requester (teaching or not) - a same-department
  // colleague named as the point of contact for whatever else the requester
  // handles day-to-day, separate from and in addition to period substitutes
  // (e.g. an HOD handing over admin duties, a College Office staffer handing
  // over their desk). Never required - a requester with nothing else to hand
  // over simply leaves this unset. Also tracked as its own AdjustmentRequest
  // (kind "HANDOVER") when set - see adjustmentRequests below.
  handoverToUid?: string;
  handoverToName?: string;
  handoverNote?: string;
  // Every named substitute/handover person's accept/decline state - see
  // AdjustmentRequest above. Undefined/empty when there was nothing to name
  // (a non-teaching leave with no handover picked) or the request predates
  // this feature.
  adjustmentRequests?: AdjustmentRequest[];
  // The status this request moves to once every adjustmentRequests entry is
  // ACCEPTED (PENDING_HOD / PENDING_PRINCIPAL / PENDING_MANAGEMENT, whichever
  // applications/route.ts POST's own routing rule picked at submission time).
  // Stashed here because that routing depends on the REQUESTER's role/dept,
  // which the accept/decline endpoint - run under the ASSIGNEE's session -
  // has no other way to recompute. Undefined whenever adjustmentRequests is
  // empty (status was never held at PENDING_ACCEPTANCE to begin with).
  postAcceptanceStatus?: LeaveRequestStatus;
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
  // Also not stored - read from the requester's own user record by the same
  // endpoint, so the Principal's "Other" leave-category picker can hide
  // Maternity for anyone who isn't female. Undefined when the requester has
  // no gender recorded, which the picker treats as "don't offer Maternity".
  requesterGender?: "Male" | "Female" | "Other";
}
