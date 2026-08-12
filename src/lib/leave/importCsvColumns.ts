// CSV column definitions for College Office's bulk Leave History import -
// matches the exact monthly register layout College Office already
// maintains outside the app (Sno / Employee Code / Employee Name /
// Department / Date of Joining / Payroll Month / Leaves Taken / Days
// Attended / Weekly Offs / Holidays / LOP / CL-SL-EL-VC OPB / CL-SL-EL-VC /
// CL-SL-EL-VC CLB / Category / Location), so an exported register can be
// edited and re-imported close to as-is - see
// api/college/leave-history-report/import/route.ts and
// LeaveHistoryReport.tsx's Export button (EXPORT_HEADERS), which produces
// this same shape.
//
// Only identity (Employee Code/Name), Payroll Month, and the four per-type
// Taken columns (CL/SL/EL/VC) are actually read on import - every other
// column here is either derived (OPB/CLB/Leaves Taken/LOP/Category, always
// recomputed live from the committed Taken values, never trusted from the
// file) or out of this module's scope (Department/Date of Joining/Location/
// attendance columns) and is accepted-but-ignored so a full exported file
// round-trips without erroring on "unrecognized" columns.
//
// "VC" is On Duty (OD) - unlimited, no balance ever tracked for it, so its
// OPB/CLB are always 0 on export and ignored on import either way.

export interface LeaveImportCsvColumn {
  key: string;
  label: string;
  required: boolean;
  sample: string;
  aliases?: string[];
}

export const LEAVE_IMPORT_COLUMNS: LeaveImportCsvColumn[] = [
  { key: "sno", label: "Sno", required: false, sample: "1" },
  { key: "employeeId", label: "Employee Code", required: false, sample: "EMP1023", aliases: ["Emp Code", "Emp ID"] },
  { key: "employeeName", label: "Employee Name", required: false, sample: "Dr. A. Ravi Kumar", aliases: ["Name", "Staff Name"] },
  { key: "department", label: "Department", required: false, sample: "CSE" },
  { key: "dateOfJoining", label: "Date of Joining", required: false, sample: "" },
  { key: "payrollMonth", label: "Payroll Month (YYYY/MM/DD)", required: true, sample: "2025/06/01", aliases: ["Payroll Month", "Month"] },
  { key: "leavesTaken", label: "Leaves Taken", required: false, sample: "" },
  { key: "daysAttended", label: "Days Attended", required: false, sample: "" },
  { key: "weeklyOffs", label: "Weekly Offs", required: false, sample: "" },
  { key: "holidays", label: "Holidays", required: false, sample: "" },
  { key: "lop", label: "LOP", required: false, sample: "" },
  { key: "clOpb", label: "CL OPB", required: false, sample: "" },
  { key: "slOpb", label: "SL OPB", required: false, sample: "" },
  { key: "elOpb", label: "EL OPB", required: false, sample: "" },
  { key: "vcOpb", label: "VC OPB", required: false, sample: "" },
  { key: "cl", label: "CL", required: false, sample: "1" },
  { key: "sl", label: "SL", required: false, sample: "0" },
  { key: "el", label: "EL", required: false, sample: "0" },
  { key: "vc", label: "VC", required: false, sample: "0" },
  { key: "clClb", label: "CL CLB", required: false, sample: "" },
  { key: "slClb", label: "SL CLB", required: false, sample: "" },
  { key: "elClb", label: "EL CLB", required: false, sample: "" },
  { key: "vcClb", label: "VC CLB", required: false, sample: "" },
  { key: "category", label: "Category", required: false, sample: "" },
  { key: "location", label: "Location", required: false, sample: "" },
];

export const LEAVE_IMPORT_HINTS = [
  "Provide either Employee Code or Employee Name (or both) - Employee Code is matched exactly when present, otherwise the name is matched case/punctuation-insensitively against an existing staff login account.",
  "Payroll Month should be in YYYY/MM/DD format (e.g. \"2025/06/01\") - the day is ignored, only the month/year it falls in is used to record the row's leave against.",
  "CL, SL, EL and VC are the only leave figures read from the file - each is the number of days taken that month (VC = On Duty). Leave any blank/0 if none were taken.",
  "OPB, CLB, Leaves Taken, LOP, Category, Department, Date of Joining and Location are all derived/informational - shown on Export, but ignored on Import (recomputed automatically from the CL/SL/EL/VC figures instead, so they're never out of sync).",
  "Days beyond what the employee had remaining at the time aren't blocked - the excess is recorded as Loss of Pay, same as a normal approval. Rows are processed oldest Payroll Month first per employee so this comes out correct regardless of file order.",
  "Every imported figure is recorded as already-APPROVED leave (this is a record of leave already taken), not a new pending request.",
];
