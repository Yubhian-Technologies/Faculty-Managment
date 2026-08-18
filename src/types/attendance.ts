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

// ─── Roster monthly export (department-wide / college-wide CSV) ───────────────
// One row per person per day - flattened output of running fillMissingDays
// once per roster member and concatenating the results, sorted by
// department, then name, then date (see buildRosterMonthlyRows).

export interface MonthlyExportRow {
  facultyId: string;
  facultyName: string;
  role: string;          // human-readable label: "HOD" | "Faculty" | "Principal" | "Vice Principal"
  department: string;
  date: string;           // yyyy-mm-dd
  status: AttendanceStatus | string; // real status, or a synthetic one from fillMissingDays (HOLIDAY/ABSENT)
  checkIn: string | null;
  checkOut: string | null;
  remarks: string | null;
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

// Who the holiday applies to. Only "BOTH" holidays are working-day exclusions
// for faculty (see holidaysCount.ts) - a students-only holiday (e.g. a study
// holiday) doesn't exempt faculty from attendance/leave-day counting.
export type HolidayAudience = "STUDENTS" | "BOTH";

export const HOLIDAY_AUDIENCE_LABELS: Record<HolidayAudience, string> = {
  STUDENTS: "Students only",
  BOTH: "Faculty & Students",
};

export interface Holiday {
  id: string;
  collegeId: string;
  date: Timestamp;
  name: string;
  type: HolidayType;
  // Absent on holidays created before this field existed - treat as "BOTH"
  // everywhere it's read (holidaysCount.ts), matching their prior behavior.
  appliesTo?: HolidayAudience;
  academicYear: string;       // "2025-26"
  createdAt: Timestamp;
}
