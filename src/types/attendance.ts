import type { Timestamp } from "firebase/firestore";
import type { UserRole } from "./core";

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
  source: "MANUAL" | "BIOMETRIC" | "SYSTEM" | "IMPORTED";
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
  // Snapshot of AttendanceCheckInPermission.permittedCheckInTime, copied onto
  // the record at the moment checkIn is set (whichever route sets it - self
  // check-in, HOD manual mark, or import) if a permission for that person/day
  // existed at that time - see lib/attendance/lateStatus.ts's isLateCheckIn,
  // which every "Late" badge/count in the app derives from. Kept as a
  // snapshot rather than re-resolved live on every read so a permission
  // granted AFTER the fact (or later revoked) never silently changes how an
  // already-recorded day reads.
  permittedCheckInTime?: string; // "HH:MM" 24h
  remarks?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Late Check-In Permission (HOD-granted grace, one faculty, one day) ────────
// Distinct from permissionRequestId above (a faculty's own request for
// partial-day leave, "Permission & On-Duty") - this is the opposite
// direction: an HOD proactively excusing a late arrival in advance (e.g.
// "Dr. Anil is coming late today, that's fine"). A FULL exemption for the
// whole day, not a raised-but-still-enforced cutoff - once granted, that
// faculty member's own self-check-in never gets flagged Late or draws down
// toward the 3-late -> 0.5 CL penalty (lib/leave/lateAttendancePenalty.ts)
// no matter how late it actually lands. One per (uid, date) - doc id
// `${uid}_${dateISO}`, same keying convention as attendanceRecords.
export interface AttendanceCheckInPermission {
  id: string;
  collegeId: string;
  uid: string;
  facultyName: string;
  department: string;
  date: Timestamp;
  // "HH:MM" 24h - the time agreed with the faculty member, kept as a record
  // of what was granted. NOT an enforced cutoff - see isLateCheckIn, which
  // treats this field's mere presence as "never late today", regardless of
  // the value or the actual check-in time.
  permittedCheckInTime: string;
  reason: string;
  grantedBy: string;            // uid of the HOD who granted it
  grantedByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Roster monthly export (department-wide / college-wide CSV) ───────────────
// One row per person for the whole month - counts derived from running
// fillMissingDays once per roster member and tallying each real/synthesized
// day's status, sorted by department then name (see
// buildRosterMonthlySummary). Deliberately not one row per person per day -
// at real headcounts (hundreds to thousands of people) that produces tens of
// thousands of CSV rows for one month, which is both slow to open and not
// what anyone actually wants from a monthly export (the day-by-day breakdown
// for one person is still available from that person's own "My Attendance"/
// PersonMonthlyAttendanceView export).

export interface MonthlySummaryRow {
  facultyId: string;
  facultyName: string;
  role: string;          // human-readable label: "HOD" | "Faculty" | "Principal" | "Vice Principal" | ...
  department: string;
  totalDays: number;      // days actually counted - excludes future days and any day before face registration
  present: number;
  absent: number;
  halfDay: number;
  onLeave: number;
  onDuty: number;
  holiday: number;
  lateArrivals: number;   // of the `present` days, how many had a check-in after the 9:05 cutoff
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

// ─── Working Day Override ──────────────────────────────────────────────────
// Flips a normally-off Sunday into a working day for specific roles - e.g.
// the Principal alone, or a subset of faculty, coming in for an inspection or
// event. Maintained in the same Office/Principal/VP-only Settings screen as
// Holidays (see college-office/holidays/page.tsx) but kept as its own
// collection since it targets specific roles rather than everyone, and
// exempts nobody by default - only the listed roles are affected; anyone else
// still gets the day off as usual. See lib/attendance/workingDays.ts for how
// this overrides the hardcoded Sunday rule (isSunday in attendanceWindow.ts)
// on a per-date, per-role basis for both self-attendance check-in and leave
// day counting (dayCounter.ts's countWorkingDays).
export interface WorkingDayOverride {
  id: string;
  collegeId: string;
  date: Timestamp;
  reason: string;
  roles: UserRole[];           // which roles are required to work this day
  // Whether the named roles are only required for half the day - e.g. a
  // forenoon-only inspection. Absent/false means the full day, same
  // convention as LeaveRequest.isHalfDay. Purely informational for
  // self-attendance check-in (still a single check-in/check-out for the
  // day), but a half day only draws down HALF a leave day if the requester
  // takes leave on it instead of coming in - see countWorkingDays'
  // workingDayWeights param in dayCounter.ts.
  isHalfDay?: boolean;
  // Which half - only meaningful when isHalfDay is true. Same convention as
  // LeaveRequest.halfDaySession.
  halfDaySession?: "FN" | "AN";
  academicYear: string;        // "2025-26"
  createdAt: Timestamp;
}
