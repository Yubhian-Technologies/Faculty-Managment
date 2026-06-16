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
