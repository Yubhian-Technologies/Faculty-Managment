import type { LeaveTypeCode } from "@/types/leave";
import type { LeaveImportCsvColumn } from "@/lib/leave/importCsvColumns";

// The year-wise Leave History import: ONE row per employee per calendar year, carrying that
// year's Weekly Offs and Holidays and, for each of CL / SL / EL / VC, a yearly Total plus a
// Jan..Dec breakdown. Month figures give the month-wise record; a Total with no months is
// recorded in January (the file does not say which months, so none are invented).

/** Where each employee-year's imported Weekly Offs / Holidays live: colleges/{id}/leaveYearlyRecords/{uid}_{year}. */
export const YEARLY_RECORDS_COL = "leaveYearlyRecords";

export const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

// "VC" (the register's own label for On Duty) is the only name that differs from its LeaveTypeCode.
export const YEARLY_TYPES: { key: "cl" | "sl" | "el" | "vc"; label: string; code: LeaveTypeCode }[] = [
  { key: "cl", label: "CL", code: "CL" },
  { key: "sl", label: "SL", code: "SL" },
  { key: "el", label: "EL", code: "EL" },
  { key: "vc", label: "VC", code: "OD" },
];

export const monthKey = (type: string, month: number) => `${type}${MONTH_ABBR[month - 1]}`;
export const totalKey = (type: string) => `${type}Total`;

export const YEARLY_IMPORT_COLUMNS: LeaveImportCsvColumn[] = [
  { key: "employeeId", label: "Employee Code", required: false, sample: "EMP1023", aliases: ["Emp Code", "Emp ID"] },
  { key: "employeeName", label: "Employee Name", required: false, sample: "Dr. A. Ravi Kumar", aliases: ["Name", "Staff Name"] },
  { key: "year", label: "Year", required: true, sample: "2024", aliases: ["Calendar Year"] },
  { key: "weeklyOffs", label: "Weekly Offs", required: false, sample: "52" },
  { key: "holidays", label: "Holidays", required: false, sample: "24" },
  ...YEARLY_TYPES.flatMap((t) => [
    { key: totalKey(t.key), label: `${t.label} Total`, required: false, sample: t.key === "cl" ? "4" : "0" },
    ...MONTH_ABBR.map((m, i) => ({
      key: monthKey(t.key, i + 1), label: `${t.label} ${m}`, required: false,
      sample: t.key === "cl" && (i === 1 || i === 5 || i === 8 || i === 10) ? "1" : "",
    })),
  ]),
];

export const YEARLY_IMPORT_HINTS = [
  "One row per employee per calendar year (Year = e.g. 2024, meaning January to December 2024). Give Employee Code or Employee Name (Code is matched exactly, the name loosely).",
  "Weekly Offs and Holidays are that year's totals for the employee. They are saved with the employee's year and shown in the Yearly leave report for that year.",
  "For each of CL, SL, EL and VC (On Duty) fill the Jan-Dec columns to keep the month-wise record. The Total column is optional when the months are filled; if both are given they must agree.",
  "A Total with no month columns is recorded in January, because the file does not say which months the leave fell in.",
  "Days beyond what the employee had remaining at the time aren't blocked - the excess is recorded as Loss of Pay, same as a normal approval. Years are processed oldest first per employee.",
  "Every figure is recorded as already-APPROVED leave. A month already imported for the same employee and leave type is skipped, so a file can be uploaded again safely.",
];

export interface YearlyTask {
  code: LeaveTypeCode;
  month: number; // 1-12
  days: number;
}

export type YearlyRowPlan =
  | { ok: true; year: number; weeklyOffs?: number; holidays?: number; tasks: YearlyTask[] }
  | { ok: false; error: string };

type Cells = Record<string, string | undefined>;

/** Blank -> null; a non-negative number -> itself; anything else -> "invalid". */
function readCount(raw: string | undefined): number | null | "invalid" {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : "invalid";
}

export function planYearlyRow(row: Cells): YearlyRowPlan {
  const yearText = (row.year ?? "").trim();
  const year = /^\d{4}$/.test(yearText) ? Number(yearText) : NaN;
  if (!(year >= 1990 && year <= 2100)) return { ok: false, error: `Year must be a 4-digit year (e.g. 2024), got "${yearText}"` };

  const weeklyOffs = readCount(row.weeklyOffs);
  const holidays = readCount(row.holidays);
  if (weeklyOffs === "invalid" || holidays === "invalid") return { ok: false, error: "Weekly Offs and Holidays must be numbers" };
  if ((weeklyOffs ?? 0) > 366 || (holidays ?? 0) > 366) return { ok: false, error: "Weekly Offs and Holidays can't be more than 366 in a year" };

  const tasks: YearlyTask[] = [];
  for (const t of YEARLY_TYPES) {
    const total = readCount(row[totalKey(t.key)]);
    if (total === "invalid") return { ok: false, error: `${t.label} Total must be a number` };
    const months: number[] = [];
    for (let m = 1; m <= 12; m++) {
      const v = readCount(row[monthKey(t.key, m)]);
      if (v === "invalid") return { ok: false, error: `${t.label} ${MONTH_ABBR[m - 1]} must be a number` };
      months.push(v ?? 0);
    }
    const monthSum = months.reduce((s, n) => s + n, 0);
    if (monthSum > 0) {
      if (total != null && Math.abs(total - monthSum) > 0.001) {
        return { ok: false, error: `${t.label}: the months add up to ${monthSum} but ${t.label} Total says ${total}` };
      }
      months.forEach((days, i) => { if (days > 0) tasks.push({ code: t.code, month: i + 1, days }); });
    } else if (total != null && total > 0) {
      tasks.push({ code: t.code, month: 1, days: total });
    }
  }
  return {
    ok: true,
    year,
    ...(weeklyOffs != null ? { weeklyOffs } : {}),
    ...(holidays != null ? { holidays } : {}),
    tasks,
  };
}
