import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Timestamp } from "firebase/firestore";
import { neutraliseFormula } from "./csv";
import { type WorkflowStatus, type CandidateStatus, type MonthlySummaryRow } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type FirestoreTimestampLike =
  | { _seconds?: number; _nanoseconds?: number; toDate?: () => Date }
  | { seconds?: number; nanoseconds?: number; toDate?: () => Date }
  | { toDate?: () => Date; seconds?: number; _seconds?: number };

export function toDate(timestamp: Timestamp | Date | FirestoreTimestampLike | string | null | undefined): Date | null {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return timestamp;
  if (typeof (timestamp as Timestamp).toDate === "function") return (timestamp as Timestamp).toDate();
  // Admin SDK serialises to { _seconds, _nanoseconds } or { seconds, nanoseconds }
  const secs = (timestamp as { _seconds?: number; seconds?: number })._seconds
    ?? (timestamp as { seconds?: number }).seconds;
  if (typeof secs === "number") return new Date(secs * 1000);
  // A plain Date serialises over JSON as an ISO string (e.g. a display-only
  // synthesized record - see fillMissingDays - that was never a Firestore
  // Timestamp to begin with) - fall back to parsing it directly rather than
  // silently collapsing to the Unix epoch.
  if (typeof timestamp === "string") {
    const trimmed = timestamp.trim();
    const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
    if (dmy) {
      const [, dd, mm, yyyy] = dmy;
      const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
      if (!Number.isNaN(d.getTime())) return d;
    }
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

// THE date style of the whole site: DD/MM/YYYY ("19/11/2026"). Every date with a year that people read - pages,
// exports, PDFs - goes through formatDate / formatDMY / formatDateTime (or dmy for a plain "YYYY-MM-DD"), never a
// hand-built toLocaleDateString. Stored values stay "YYYY-MM-DD" / Timestamps; only the display changes.

const IST_PARTS = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" });

/** "YYYY-MM-DD" / "D-M-YYYY" / "D/M/YYYY" string -> "DD/MM/YYYY"; null when the string is not one of those. */
function dmyFromString(value: string): string | null {
  const t = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const dmyMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  if (dmyMatch) return `${dmyMatch[1].padStart(2, "0")}/${dmyMatch[2].padStart(2, "0")}/${dmyMatch[3]}`;
  return null;
}

/** A moment -> "DD/MM/YYYY" in India time. */
function dmyOfDate(date: Date): string {
  const parts = IST_PARTS.formatToParts(date);
  const v = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${v("day")}/${v("month")}/${v("year")}`;
}

/** "2026-11-19" -> "19/11/2026" (any other text is returned as it is; blank -> ""). For plain date strings. */
export function dmy(value: string | null | undefined): string {
  if (!value) return "";
  return dmyFromString(value) ?? value;
}

/** "19/11/2026"; "-" when there is no date. */
export function formatDate(timestamp: Timestamp | Date | FirestoreTimestampLike | string | null | undefined): string {
  if (typeof timestamp === "string") {
    const fromString = dmyFromString(timestamp);
    if (fromString) return fromString;
  }
  const date = toDate(timestamp);
  if (!date || Number.isNaN(date.getTime())) return "-";
  return dmyOfDate(date);
}

/** "19/11/2026"; "" when there is no date (a year alone, e.g. "2019", is returned as it is). */
export function formatDMY(
  input: Timestamp | Date | FirestoreTimestampLike | string | null | undefined
): string {
  if (!input) return "";
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return "";
    const fromString = dmyFromString(trimmed);
    if (fromString) return fromString;
    if (/^\d{4}$/.test(trimmed)) return trimmed;
  }
  const date = toDate(input as Parameters<typeof toDate>[0]);
  if (!date || Number.isNaN(date.getTime())) return typeof input === "string" ? input : "";
  return dmyOfDate(date);
}

// "09:00" -> "9:00 AM" - display only, stored/submitted values stay 24h "HH:MM".
export function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

// Monday..Saturday Date objects for the calendar week containing `today` -
// pairs positionally with a `DAYS: DayOfWeek[] = ["MON", ..., "SAT"]` array
// so a weekly timetable grid can label each column with its actual date
// (e.g. "Thursday 20") and show the week's own From/To range in its header.
// Client-side display only (plain browser `now`, not IST-anchored like the
// server's todayISODate) - fine since the page already renders in the
// viewer's own timezone; never used for any query, write, or date matching.
export function currentWeekDates(today: Date = new Date()): Date[] {
  const day = today.getDay(); // 0=Sun..6=Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + mondayOffset);
  return Array.from({ length: 6 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
}

/** "19/11/2026, 02:10 PM" (India time); "-" when there is no date. */
export function formatDateTime(timestamp: Timestamp | Date | FirestoreTimestampLike | null | undefined): string {
  const date = toDate(timestamp);
  if (!date || Number.isNaN(date.getTime())) return "-";
  const time = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).toUpperCase();
  return `${dmyOfDate(date)}, ${time}`;
}

// Formats a Firestore Timestamp (or admin-SDK-serialized equivalent, or Date, or YYYY-MM-DD string) as a yyyy-mm-dd
// string suitable for <input type="date">.
export function toDateInputValue(timestamp: Timestamp | Date | FirestoreTimestampLike | string | null | undefined): string {
  if (typeof timestamp === "string") {
    const trimmed = timestamp.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
    if (dmy) {
      const [, dd, mm, yyyy] = dmy;
      return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    }
  }
  const date = toDate(timestamp);
  if (!date) return "";
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function getInitials(name: string | undefined | null): string {
  if (!name?.trim()) return "?";
  return name
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function getWorkflowStatusColor(status: WorkflowStatus | CandidateStatus): string {
  const colorMap: Record<string, string> = {
    PENDING: "bg-yellow-100 text-yellow-800 border-yellow-200",
    APPROVED: "bg-green-100 text-green-800 border-green-200",
    REJECTED: "bg-red-100 text-red-800 border-red-200",
    MODIFIED: "bg-orange-100 text-orange-800 border-orange-200",
    IN_PROGRESS: "bg-blue-100 text-blue-800 border-blue-200",
    COMPLETED: "bg-green-100 text-green-800 border-green-200",
    WAITLISTED: "bg-purple-100 text-purple-800 border-purple-200",
    SHORTLISTED: "bg-blue-100 text-blue-800 border-blue-200",
    ARRIVED: "bg-teal-100 text-teal-800 border-teal-200",
  };
  return colorMap[status] ?? "bg-gray-100 text-gray-800 border-gray-200";
}

/** The CSV text exportToCSV downloads - cells that would run as a spreadsheet formula are neutralised. */
export function buildCsvText<T extends Record<string, unknown>>(
  data: T[],
  columns: { key: string; header: string }[]
): string {
  const headers = columns.map((c) => c.header).join(",");
  const rows = data.map((row) =>
    columns
      .map((c) => {
        const val = row[c.key];
        // A stored "YYYY-MM-DD" goes out in the site's DD/MM/YYYY.
        const str = neutraliseFormula(val === null || val === undefined ? "" : typeof val === "string" ? dmy(val) : String(val));
        return `"${str.replace(/"/g, '""')}"`;
      })
      .join(",")
  );
  return [headers, ...rows].join("\n");
}

export function exportToCSV<T extends Record<string, unknown>>(
  data: T[],
  filename: string,
  columns: { key: string; header: string }[]
): void {
  const csv = buildCsvText(data, columns);
  // Leading UTF-8 BOM - without it, Excel on Windows opens a local CSV using
  // the system ANSI codepage regardless of the Blob's declared charset, so
  // any non-ASCII character (e.g. the "—" placeholder for a null percentage)
  // renders as mojibake ("â€"") instead of the real character.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// Shared CSV shape for the department-wide / college-wide monthly exports
// (one row per person for the whole month, from buildRosterMonthlySummary)
// - reused by every "Export Month CSV" button (HOD, Principal/VP,
// Management). Deliberately one row per person, not one row per person per
// day - at real headcounts (hundreds to thousands) a day-by-day export
// becomes tens of thousands of rows for one month, which is both slow to
// open and not what a roster-wide export is for. The day-by-day breakdown
// for one person is still available from that person's own "My Attendance"
// export (see PersonMonthlyAttendanceView.handleExport).
export function exportRosterMonthlyCSV(rows: MonthlySummaryRow[], filenameBase: string): void {
  const csvRows = rows.map((r) => ({
    facultyName: r.facultyName,
    role: r.role,
    department: r.department,
    totalDays: r.totalDays,
    present: r.present,
    absent: r.absent,
    halfDay: r.halfDay,
    onLeave: r.onLeave,
    onDuty: r.onDuty,
    holiday: r.holiday,
    lateArrivals: r.lateArrivals,
  }));
  exportToCSV(csvRows, filenameBase, [
    { key: "facultyName", header: "Name" },
    { key: "role", header: "Role" },
    { key: "department", header: "Department" },
    { key: "totalDays", header: "Total Days" },
    { key: "present", header: "Present" },
    { key: "absent", header: "Absent" },
    { key: "halfDay", header: "Half Day" },
    { key: "onLeave", header: "On Leave" },
    { key: "onDuty", header: "On Duty" },
    { key: "holiday", header: "Holiday" },
    { key: "lateArrivals", header: "Late Arrivals" },
  ]);
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + "…";
}

// Strips leading zeros from a numeric <input> string as the user types
// (e.g. "05" -> "5", "00" -> "0", "0.5" untouched) - for number inputs whose
// value is kept as a raw string (custom per-item "extra fields", etc.)
// rather than parsed through Number() on every keystroke, native browser
// number inputs don't self-correct this, so it has to be done explicitly.
export function stripLeadingZeros(value: string): string {
  if (value === "") return value;
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const stripped = unsigned.replace(/^0+(?=\d)/, "");
  return negative ? `-${stripped}` : stripped;
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
