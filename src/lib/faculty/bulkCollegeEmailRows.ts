import { EMAIL_REGEX } from "@/lib/validations";

// Row-level rules of the bulk "Change College Email" upload that need no database - shared (client-safe, no server
// imports) by the page, which checks the WHOLE file before sending anything, and the API, which re-checks every chunk.

export type BulkRowStatus = "UPDATED" | "UNCHANGED" | "FAILED";

export interface BulkRowResult {
  /** The row's position in the uploaded file (1-based, header = row 1). */
  fileRow: number;
  employeeId: string;
  status: BulkRowStatus;
  /** Machine-readable reason for a FAILED row. */
  code?: string;
  message: string;
  oldEmail?: string;
  newEmail?: string;
}

export const ROW_ERROR = {
  MISSING_EMPLOYEE_ID: "Employee ID is required",
  MISSING_EMAIL: "New College Email is required",
  INVALID_EMAIL: "Enter a valid email address",
  NOT_FOUND: "No faculty member with this Employee ID in your college",
  AMBIGUOUS: "More than one faculty record has this Employee ID - fix the duplicate first",
  DUPLICATE_ROW: "This Employee ID appears more than once in the file - only its first row is used",
  DUPLICATE_EMAIL_IN_FILE: "This new email is used by more than one row of the file - only its first row is used",
} as const;

export const ALREADY_SAME_MESSAGE = "Already the same college email - no update was made";

export const normalizeBulkEmail = (raw: unknown): string => String(raw ?? "").trim().toLowerCase();

export interface BulkInputRow {
  fileRow?: number;
  employeeId?: unknown;
  newEmail?: unknown;
}

export interface CleanBulkRow {
  fileRow: number;
  employeeId: string;
  newEmail: string;
}

export function bulkFailure(fileRow: number, employeeId: string, code: keyof typeof ROW_ERROR | string, message: string, extra: Partial<BulkRowResult> = {}): BulkRowResult {
  return { fileRow, employeeId, status: "FAILED", code, message, ...extra };
}

/**
 * Splits rows into the ones worth sending (`ok`, cleaned: trimmed Employee ID, lower-cased email) and the ones refused up
 * front (`rejected`, already shaped as results): a blank Employee ID or email, an invalid email, an Employee ID that
 * appears earlier in the same file, and a new email used by an earlier row. The FIRST occurrence always wins.
 */
export function validateBulkRows(rows: BulkInputRow[], firstFileRow = 2): { ok: CleanBulkRow[]; rejected: BulkRowResult[] } {
  const ok: CleanBulkRow[] = [];
  const rejected: BulkRowResult[] = [];
  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();
  rows.forEach((rec, i) => {
    const fileRow = typeof rec?.fileRow === "number" ? rec.fileRow : firstFileRow + i;
    const employeeId = typeof rec?.employeeId === "string" || typeof rec?.employeeId === "number" ? String(rec.employeeId).trim() : "";
    const newEmail = normalizeBulkEmail(rec?.newEmail);
    if (!employeeId) { rejected.push(bulkFailure(fileRow, "-", "MISSING_EMPLOYEE_ID", ROW_ERROR.MISSING_EMPLOYEE_ID, newEmail ? { newEmail } : {})); return; }
    if (!newEmail) { rejected.push(bulkFailure(fileRow, employeeId, "MISSING_EMAIL", ROW_ERROR.MISSING_EMAIL)); return; }
    if (!EMAIL_REGEX.test(newEmail)) { rejected.push(bulkFailure(fileRow, employeeId, "INVALID_EMAIL", ROW_ERROR.INVALID_EMAIL, { newEmail })); return; }
    if (seenIds.has(employeeId.toLowerCase())) { rejected.push(bulkFailure(fileRow, employeeId, "DUPLICATE_ROW", ROW_ERROR.DUPLICATE_ROW, { newEmail })); return; }
    if (seenEmails.has(newEmail)) { rejected.push(bulkFailure(fileRow, employeeId, "DUPLICATE_EMAIL_IN_FILE", ROW_ERROR.DUPLICATE_EMAIL_IN_FILE, { newEmail })); return; }
    seenIds.add(employeeId.toLowerCase());
    seenEmails.add(newEmail);
    ok.push({ fileRow, employeeId, newEmail });
  });
  return { ok, rejected };
}
