import type { Timestamp } from "firebase/firestore";

// ─── Attendance Record (one per faculty per working day) ──────────────────────

export type AttendanceStatus =
  | "PRESENT"
  | "ABSENT"
  | "HALF_DAY"
  | "ON_LEAVE"
  | "ON_DUTY"
  | "HOLIDAY"
  | "WEEKEND";

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  HALF_DAY: "Half Day",
  ON_LEAVE: "On Leave",
  ON_DUTY: "On Duty",
  HOLIDAY: "Holiday",
  WEEKEND: "Weekend",
};

export interface AttendanceRecord {
  id: string;
  collegeId: string;
  facultyId: string;
  facultyName: string;
  department: string;
  date: Timestamp;              // normalised to midnight of that day
  status: AttendanceStatus;
  checkIn?: string;             // "HH:MM" 24h (from biometric or manual)
  checkOut?: string;            // "HH:MM" 24h
  source: "MANUAL" | "BIOMETRIC" | "SYSTEM";
  markedBy?: string;            // uid of staff who marked manually
  // Self-check-in/out verification metadata (source === "BIOMETRIC" only).
  // Face matching runs entirely in the faculty's browser — no photo is ever
  // uploaded, only the resulting distance/verified flag is recorded here.
  checkInLocation?: { latitude: number; longitude: number };
  checkInFaceMatchDistance?: number;
  checkInVerified?: boolean;
  checkOutLocation?: { latitude: number; longitude: number };
  checkOutFaceMatchDistance?: number;
  checkOutVerified?: boolean;
  leaveApplicationId?: string;  // populated when status is ON_LEAVE
  onDutyRequestId?: string;     // populated when status is ON_DUTY
  permissionRequestId?: string; // populated for partial-day permission
  remarks?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Monthly Attendance Summary ───────────────────────────────────────────────
// Aggregated each time attendance is marked. doc id: `${facultyId}_${year}_${month}`

export interface AttendanceSummary {
  id: string;
  collegeId: string;
  facultyId: string;
  facultyName: string;
  department: string;
  year: number;
  month: number;              // 1–12
  totalWorkingDays: number;
  present: number;
  absent: number;
  halfDay: number;
  onLeave: number;
  onDuty: number;
  holiday: number;
  lossOfPayDays: number;      // absent days without approved leave
  updatedAt: Timestamp;
}

// ─── Academic Calendar Holiday ─────────────────────────────────────────────────

export type HolidayType = "NATIONAL" | "REGIONAL" | "COLLEGE" | "RESTRICTED";

export const HOLIDAY_TYPE_LABELS: Record<HolidayType, string> = {
  NATIONAL: "National",
  REGIONAL: "Regional",
  COLLEGE: "College",
  RESTRICTED: "Restricted",
};

export interface Holiday {
  id: string;
  collegeId: string;
  date: Timestamp;
  name: string;
  type: HolidayType;
  academicYear: string;       // "2025-26"
  createdAt: Timestamp;
}
