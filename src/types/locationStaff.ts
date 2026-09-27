import type { Timestamp } from "firebase/firestore";

// ─── Location Department ───────────────────────────────────────────────────────
export interface LocationDepartment {
  id: string;
  locationId: string;
  name: string;
  code: string;
  headUid?: string;
  headStaffId?: string;
  headName?: string;
  headEmail?: string;
  headPhone?: string;
  description?: string;
  staffCount: number;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Location Staff Member ─────────────────────────────────────────────────────
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
  role: string; // e.g. Guard, Electrician, Sweeper, Plumber, Driver
  shiftId?: string;
  shiftName?: string;
  status: "ACTIVE" | "INACTIVE";
  dateOfJoining?: string; // YYYY-MM-DD
  userUid?: string;
  userEmail?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
// ─── Location Shift ────────────────────────────────────────────────────────────
export interface LocationShift {
  id: string;
  locationId: string;
  departmentId: string;
  departmentName?: string;
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

// ─── Staff Attendance ──────────────────────────────────────────────────────────
export type StaffAttendanceStatus = "PRESENT" | "ABSENT" | "HALF_DAY" | "ON_LEAVE";

export const STAFF_ATTENDANCE_STATUS_LABELS: Record<StaffAttendanceStatus, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  HALF_DAY: "Half Day",
  ON_LEAVE: "On Leave",
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
  markedByUid: string;
  markedByName: string;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
