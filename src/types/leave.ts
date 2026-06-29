import type { Timestamp } from "firebase/firestore";

// ─── Leave Types ──────────────────────────────────────────────────────────────

export type LeaveTypeCode =
  | "CASUAL"
  | "SICK"
  | "EARNED"
  | "MATERNITY"
  | "PATERNITY"
  | "COMPENSATORY"
  | "LOSS_OF_PAY"
  | "SPECIAL";

export const LEAVE_TYPE_LABELS: Record<LeaveTypeCode, string> = {
  CASUAL: "Casual Leave",
  SICK: "Sick Leave",
  EARNED: "Earned Leave",
  MATERNITY: "Maternity Leave",
  PATERNITY: "Paternity Leave",
  COMPENSATORY: "Compensatory Leave",
  LOSS_OF_PAY: "Loss of Pay",
  SPECIAL: "Special Leave",
};

// Default annual entitlements per leave type
export const DEFAULT_LEAVE_ENTITLEMENTS: Record<LeaveTypeCode, number> = {
  CASUAL: 12,
  SICK: 12,
  EARNED: 15,
  MATERNITY: 180,   // days
  PATERNITY: 15,
  COMPENSATORY: 0,  // earned through extra duty
  LOSS_OF_PAY: 0,   // on-demand
  SPECIAL: 0,       // on-demand
};

// ─── Leave Application Status ─────────────────────────────────────────────────

export type LeaveStatus =
  | "PENDING"
  | "HOD_APPROVED"
  | "PRINCIPAL_APPROVED"
  | "REJECTED"
  | "CANCELLED";

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  PENDING: "Pending",
  HOD_APPROVED: "HOD Approved",
  PRINCIPAL_APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

// ─── Leave Balance (one doc per faculty per year) ─────────────────────────────
// doc id: `${facultyId}_${year}`

export interface LeaveBalance {
  id: string;
  collegeId: string;
  facultyId: string;
  facultyName: string;
  department: string;
  year: number;
  balances: Record<LeaveTypeCode, {
    entitled: number;
    used: number;
    pending: number;
    balance: number;
  }>;
  updatedAt: Timestamp;
}

// ─── Leave Application ────────────────────────────────────────────────────────

export interface LeaveApplication {
  id: string;
  collegeId: string;
  facultyId: string;
  facultyName: string;
  department: string;
  leaveType: LeaveTypeCode;
  fromDate: Timestamp;
  toDate: Timestamp;
  totalDays: number;
  isHalfDay?: boolean;
  halfDaySession?: "MORNING" | "AFTERNOON";
  reason: string;
  substituteArrangement?: string;   // who covers classes during absence
  attachmentUrl?: string;           // medical certificate etc.
  status: LeaveStatus;
  hodAction?: {
    action: "APPROVED" | "REJECTED";
    by: string;
    byName: string;
    at: Timestamp;
    remarks?: string;
  };
  principalAction?: {
    action: "APPROVED" | "REJECTED";
    by: string;
    byName: string;
    at: Timestamp;
    remarks?: string;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Permission Request (short absence within working hours) ──────────────────

export type PermissionStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface PermissionRequest {
  id: string;
  collegeId: string;
  facultyId: string;
  facultyName: string;
  department: string;
  date: Timestamp;
  fromTime: string;         // "HH:MM" 24h
  toTime: string;           // "HH:MM" 24h
  durationHours: number;
  reason: string;
  status: PermissionStatus;
  hodAction?: {
    action: "APPROVED" | "REJECTED";
    by: string;
    byName: string;
    at: Timestamp;
    remarks?: string;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── On Duty Request (official work outside campus) ───────────────────────────

export type OnDutyPurpose =
  | "EXAM_DUTY"
  | "CONFERENCE"
  | "WORKSHOP"
  | "FDP"
  | "OFFICIAL_WORK"
  | "INSPECTION"
  | "OTHER";

export const ON_DUTY_PURPOSE_LABELS: Record<OnDutyPurpose, string> = {
  EXAM_DUTY: "Exam Duty",
  CONFERENCE: "Conference",
  WORKSHOP: "Workshop / Seminar",
  FDP: "Faculty Development Programme",
  OFFICIAL_WORK: "Official Work",
  INSPECTION: "Inspection / Accreditation",
  OTHER: "Other",
};

export interface OnDutyRequest {
  id: string;
  collegeId: string;
  facultyId: string;
  facultyName: string;
  department: string;
  fromDate: Timestamp;
  toDate: Timestamp;
  totalDays: number;
  purpose: OnDutyPurpose;
  description: string;
  venue?: string;
  attachmentUrl?: string;
  status: PermissionStatus;
  hodAction?: {
    action: "APPROVED" | "REJECTED";
    by: string;
    byName: string;
    at: Timestamp;
    remarks?: string;
  };
  principalAction?: {
    action: "APPROVED" | "REJECTED";
    by: string;
    byName: string;
    at: Timestamp;
    remarks?: string;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─────────────────────────────────────────────────────────────────────────────
// Leave Module V2 — comprehensive rule-engine-driven module
// Collections: leaveTypes (root), colleges/{id}/leaveBalancesV2,
//              colleges/{id}/leaveRequests, colleges/{id}/employeeLeaveProfiles
// ─────────────────────────────────────────────────────────────────────────────

export type LeaveTypeCodeV2 =
  | "CL"    // Casual Leave
  | "SCL"   // Special Casual Leave (teaching staff)
  | "EL"    // Earned Leave
  | "ML"    // Medical / Half-Pay Leave
  | "MAT"   // Maternity Leave
  | "FPL"   // Family Planning Leave
  | "COMP"  // Compensatory Leave
  | "LND"   // Leave Not Due (advance against EL)
  | "QUAR"  // Quarantine Leave
  | "EOL"   // Extraordinary Leave (without pay)
  | "SAB"   // Sabbatical Leave
  | "VAC";  // Vacation (vacation-staff entitlement)

export type ApprovalChainV2 = "standard" | "management" | "medical_officer";
export type AccrualBasis = "annual_fixed" | "per_completed_year" | "prorated" | "none";
export type EncashPolicy = "never" | "retirement_only";

export interface DurationTier {
  label: string;
  maxDays: number;
  requiresCertificate: boolean;
  minServiceYears?: number;
  purpose?: string;
}

export interface GenderDayAllocation {
  male: number;
  female: number;
  other: number;
}

export interface DepartmentLeaveOverride {
  departmentName: string;
  maxPerApplication?: number;
  maxAccumulation?: number;
  restrictedMonths?: number[]; // 1-12
}

export interface LeaveTypeRules {
  daysPerYear?: number;
  accrualBasis?: AccrualBasis;
  carryForwardCap?: number;          // 0 = lapses; undefined = unlimited
  maxPerApplication?: number;
  minPerApplication?: number;
  advanceNoticeDays?: number;        // 0 = can apply same day / retroactive
  retroactiveAllowed?: boolean;
  excludeHolidaysAndSundays?: boolean;
  eligibility?: {
    employmentTypes?: ("permanent" | "probation" | "training")[];
    staffCategories?: ("vacation" | "non-vacation")[];
    isTeachingStaffOnly?: boolean;
    genderAllowed?: ("male" | "female" | "other")[];
    maritalStatus?: "married";
    minServiceYears?: number;
    isConfirmedRequired?: boolean;
    maxLivingChildren?: number;
    oneTimeOnly?: boolean;
  };
  certificateRequiredAfterDays?: number; // 0 = always; undefined = never
  fitnessCertRequired?: boolean;
  linkedHolidayWorkRequired?: boolean;
  remuneratedDutyBlocked?: boolean;
  encashPolicy?: EncashPolicy;
  requiresHandoverAfterDays?: number;
  approvalChain?: ApprovalChainV2;
  durationTiers?: DurationTier[];
  genderDayAllocation?: GenderDayAllocation;
  departmentOverrides?: DepartmentLeaveOverride[];
  requiresReturnToDutyAck?: boolean;
  isLeaveWithoutPay?: boolean;
  isVacationEntitlement?: boolean;
  isLeaveNotDue?: boolean;           // advance against EL; to be offset on EL credit
}

export interface LeaveTypeFull {
  id: string;
  code: LeaveTypeCodeV2;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  rules: LeaveTypeRules;
  isActive: boolean;
  sortOrder: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Employee Leave Profile ───────────────────────────────────────────────────
// doc path: colleges/{collegeId}/employeeLeaveProfiles/{uid}

export type LeaveEmploymentType = "permanent" | "probation" | "training";
export type StaffCategory = "vacation" | "non-vacation";

export interface EmployeeLeaveProfile {
  id: string;
  collegeId: string;
  uid: string;
  employmentType: LeaveEmploymentType;
  staffCategory: StaffCategory;
  isTeachingStaff: boolean;
  gender: "male" | "female" | "other";
  maritalStatus: "married" | "unmarried";
  dateOfJoining: Timestamp;
  isConfirmed: boolean;
  livingChildrenCount: number;
  maternityLeaveUsedOnce: boolean;
  retirementDate?: Timestamp;
  department?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Leave Balance V2 ─────────────────────────────────────────────────────────
// doc path: colleges/{collegeId}/leaveBalancesV2/{uid}_{leaveTypeCode}_{year}

export interface LeaveBalanceV2 {
  id: string;
  collegeId: string;
  uid: string;
  leaveTypeCode: LeaveTypeCodeV2;
  year: number;
  opening: number;
  credited: number;
  used: number;
  pending: number;
  carriedForward: number;
  updatedAt: Timestamp;
}

// ─── Leave Request V2 ─────────────────────────────────────────────────────────
// doc path: colleges/{collegeId}/leaveRequests/{id}

export type LeaveRequestStatus =
  | "DRAFT"
  | "PENDING_HOD"
  | "PENDING_RATIFICATION"
  | "PENDING_MANAGEMENT"
  | "PENDING_MEDICAL_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "RECALLED"
  | "CANCELLED";

export const LEAVE_REQUEST_STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  DRAFT: "Draft",
  PENDING_HOD: "Pending HOD",
  PENDING_RATIFICATION: "Pending Ratification",
  PENDING_MANAGEMENT: "Pending Management",
  PENDING_MEDICAL_REVIEW: "Pending Medical Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  RECALLED: "Recalled",
  CANCELLED: "Cancelled",
};

export interface LeaveRequestV2 {
  id: string;
  collegeId: string;
  employeeId: string;
  employeeName: string;
  department: string;
  leaveTypeCode: LeaveTypeCodeV2;
  fromDate: Timestamp;
  toDate: Timestamp;
  computedDays: number;
  isHalfDay?: boolean;
  halfDaySession?: "MORNING" | "AFTERNOON";
  reason: string;
  leaveAddress: string;
  contactNumber: string;
  substituteArrangement?: string;
  handoverToUserId?: string;
  handoverNotes?: string;
  medicalCertificateUrl?: string;
  fitnessCertificateUrl?: string;
  linkedHolidayWorkId?: string;
  otherEmploymentAck: boolean;
  status: LeaveRequestStatus;
  currentApproverRole?: string;
  isExceptionFlag?: boolean;
  exceptionComment?: string;
  appliedOn: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface LeaveApprovalStepV2 {
  id: string;
  collegeId: string;
  applicationId: string;
  approverRole: string;
  approverId?: string;
  approverName?: string;
  sequence: number;
  action?: "APPROVED" | "REJECTED" | "RECALLED";
  comments?: string;
  actedOn?: Timestamp;
  createdAt: Timestamp;
}

export interface ValidationResult {
  ok: boolean;
  code?: string;
  message?: string;
  severity?: "error" | "warning";
}

export interface LeaveValidationContext {
  fromDate: Date;
  toDate: Date;
  computedDays: number;
  leaveTypeCode: LeaveTypeCodeV2;
  leaveType: LeaveTypeFull;
  profile: EmployeeLeaveProfile;
  currentBalance: LeaveBalanceV2 | null;
  holidayDates: Set<string>;
  today: Date;
  reason?: string;
}
