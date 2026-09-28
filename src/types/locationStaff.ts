import type { Timestamp as ClientTimestamp } from "firebase/firestore";
import type { Timestamp as AdminTimestamp } from "firebase-admin/firestore";

export type Timestamp = ClientTimestamp | AdminTimestamp;

export interface LocationDepartment {
  id: string;
  locationId: string;
  name: string;
  code?: string;
  headUid?: string;
  deptHeadUid?: string;
  headStaffId?: string;
  headName?: string;
  deptHeadName?: string;
  headEmail?: string;
  headPhone?: string;
  description?: string;
  staffCount: number;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Location ────────────────────────────────────────────────────────────
export interface LocationConfig {
  id: string;
  locationId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Location Staff Member ─────────────────────────────────────────────
export interface LocationStaffMember {
  id: string;
  locationId: string;
  departmentId: string;
  departmentName: string;
  isDeptHead?: boolean;
  photoUrl?: string;
  name: string;
  fatherName: string;
  contactNumber: string;
  aadhaar: string; // 12-digit number
  spouseGuardianAadhaar?: string;
  spouseGuardianName?: string;
  spouseGuardianPhone?: string;
  address: string;
  payeeVoucher: string; // e.g. Voucher ID or payment mode / reference
  payeeType?: "Voucher Payee" | "Account Payee";
  accountNumber?: string;
  branchName?: string;
  ifscCode?: string;
  pfEnabled?: boolean;
  esiEnabled?: boolean;
  role: string; // e.g. Guard, Electrician, Sweeper, Plumber, Driver
  shiftId?: string;
  shiftName?: string;
  status: "ACTIVE" | "INACTIVE";
  dateOfJoining: string; // YYYY-MM-DD - MANDATORY
  reportAtLocationId?: string; // Which campus location this staff reports at
   userUid?: string;
   userEmail?: string;
   reportAtLocationName?: string; // Resolved display name of the reportAtLocation
   leaveBalance?: number; // Total configured leaves
   leaveTaken?: number; // Leaves already taken
   createdAt: Timestamp;
   updatedAt: Timestamp;
 }
// ─── Location Shift ────────────────────────────────────────────────────
export interface LocationShift {
  id: string;
  locationId: string;
  departmentId: string;
  departmentName?: string;
  departmentIds?: string[];
  departmentNames?: string[];
  isCampusWide?: boolean;
  deptAssignedStaffCount?: number;
  name: string; // e.g. "Morning Shift", "Night Shift", "General"
  startTime: string; // 24-hr format "06:00"
  endTime: string; // 24-hr format "14:00"
  gracePeriodMinutes?: number;
  description?: string;
  isActive: boolean;
  assignedStaffCount?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Staff Attendance ──────────────────────────────────────────────────
export type StaffAttendanceStatus = "PRESENT" | "ABSENT" | "HALF_DAY" | "ON_LEAVE" | "LATE";

export const STAFF_ATTENDANCE_STATUS_LABELS: Record<StaffAttendanceStatus, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  HALF_DAY: "Half Day",
  ON_LEAVE: "On Leave",
  LATE: "Late",
};

export interface LocationStaffAttendanceRecord {
  id: string; // `${date}_${staffId}`
  locationId: string;
  departmentId: string;
  staffId: string;
  staffName: string;
  staffRole: string;
  shiftId?: string;
  shiftName?: string;
  date: string; // "YYYY-MM-DD"
  status: StaffAttendanceStatus;
  checkInTime?: string; // e.g. "08:45 AM"
  checkOutTime?: string; // e.g. "05:10 PM"
  isLate?: boolean;
  isLateCheckIn?: boolean;
  isOutOfTimeCheckOut?: boolean;
  checkInTimingStatus?: "ON_TIME" | "LATE" | "EARLY";
  checkOutTimingStatus?: "ON_TIME" | "EARLY" | "OVERTIME" | "OUT_OF_TIME";
  isEmergencyDuty?: boolean;
  emergencyReason?: string;
  dutyType?: "REGULAR" | "EMERGENCY" | "EXTRA";
  markedByUid: string;
  markedByName: string;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Leave Request ──────────────────────────────────────────────────────
export interface LeaveRequest {
  id: string;
  staffId: string;
  locationId: string;
  departmentId: string;
  staffName: string;
  leaveType: "CL" | "EL" | "SL" | "PL" | "OTHER";
  startDate: string;
  endDate: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  appliedByUid: string;
  approvedByUid?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  [key: string]: unknown;
}
