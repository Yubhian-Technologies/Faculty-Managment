// CSV column definitions for bulk-backfilling old attendance history - see
// api/college/attendance/import/route.ts. One row = one person's status for
// one past date. Deliberately narrow (no Name/Department columns): the
// importer's own scope (their department/unit, or the whole college for
// Principal/VP) already determines who a row can apply to, so only the
// Employee ID is needed to resolve it.

export interface AttendanceImportCsvColumn {
  key: string;
  label: string;
  required: boolean;
  sample: string;
  aliases?: string[];
}

export const ATTENDANCE_IMPORT_COLUMNS: AttendanceImportCsvColumn[] = [
  { key: "employeeId", label: "Employee ID", required: true, sample: "EMP1023", aliases: ["Emp ID", "Employee Code"] },
  { key: "date", label: "Date (YYYY-MM-DD)", required: true, sample: "2025-03-15", aliases: ["Date"] },
  { key: "status", label: "Status", required: true, sample: "Present", aliases: ["Attendance", "Attendance Status"] },
  { key: "checkIn", label: "Check In (HH:MM)", required: false, sample: "09:00", aliases: ["Check In"] },
  { key: "checkOut", label: "Check Out (HH:MM)", required: false, sample: "17:00", aliases: ["Check Out"] },
  { key: "remarks", label: "Remarks", required: false, sample: "" },
];

export const ATTENDANCE_IMPORT_HINTS = [
  "Employee ID is matched exactly (case-insensitive) against an existing staff login account within your scope - a row for anyone outside your department/unit is rejected.",
  "Date must be YYYY-MM-DD (e.g. \"2025-03-15\") and strictly before today - this import is for backfilling old history, not marking today's or a future date.",
  "Status accepts either the plain word (Present, Absent, Half Day, On Leave, On Duty, Holiday) or its internal code (PRESENT, ABSENT, ...).",
  "Check In / Check Out are optional (HH:MM, 24-hour) - leave blank for days with no recorded time, e.g. Absent, Holiday, or On Leave.",
  "A row is skipped, never overwritten, if that person already has any attendance record for that date - this import only fills gaps in the history.",
];
