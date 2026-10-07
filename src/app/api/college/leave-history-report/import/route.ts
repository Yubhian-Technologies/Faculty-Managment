export const dynamic = "force-dynamic";

import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { commitImportTasks, loadStaffLookup, resolveStaffUid, sortImportTasks, type ImportTask } from "@/lib/leave/historyImport";
import type { LeaveTypeCode } from "@/types/leave";

// Matches College Office's register CSV shape (see lib/leave/importCsvColumns.ts
// and LeaveHistoryReport.tsx's EXPORT_HEADERS) - only identity, Payroll Month,
// and the four per-type Taken figures are read; every other column (OPB/CLB/
// Leaves Taken/LOP/Category/Department/Date of Joining/Location/attendance) is
// derived/informational and accepted-but-ignored so an exported file
// round-trips without erroring.
type ImportRow = {
  employeeId?: string;
  employeeName?: string;
  payrollMonth: string;
  cl?: string;
  sl?: string;
  el?: string;
  vc?: string; // On Duty
};

const MONTH_LOOKUP: Record<string, number> = {};
["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
  .forEach((name, i) => { MONTH_LOOKUP[name] = i + 1; MONTH_LOOKUP[name.slice(0, 3)] = i + 1; });

function parsePayrollMonth(raw: string | undefined): { year: number; month: number } | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  // YYYY/MM/DD or YYYY-MM-DD - the day is ignored, only the month it falls in matters.
  let m = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { year: Number(m[1]), month: Number(m[2]) };
  m = trimmed.match(/^(\d{4})[/-](\d{1,2})$/); // YYYY-MM / YYYY/MM
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { year: Number(m[1]), month: Number(m[2]) };
  m = trimmed.match(/^(\d{1,2})[/-](\d{4})$/); // MM/YYYY or MM-YYYY
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return { year: Number(m[2]), month: Number(m[1]) };
  m = trimmed.match(/^([A-Za-z]+)[\s-]+(\d{4})$/); // "June 2025" / "Jun-2025"
  if (m) {
    const month = MONTH_LOOKUP[m[1].toLowerCase()];
    if (month) return { year: Number(m[2]), month };
  }
  return null;
}

function parseDays(raw: string | undefined): number {
  const n = raw?.trim() ? Number(raw.trim()) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// "VC" (the register's own label for On Duty) is the only column name that
// doesn't match its internal LeaveTypeCode 1:1.
const IMPORT_TYPE_KEYS: { key: "cl" | "sl" | "el" | "vc"; code: LeaveTypeCode }[] = [
  { key: "cl", code: "CL" },
  { key: "sl", code: "SL" },
  { key: "el", code: "EL" },
  { key: "vc", code: "OD" },
];

// Bulk-backfills leave already taken before this module existed (or any
// other gap in the record) directly as APPROVED requests - one synthetic,
// single-day request per employee/leave-type/Payroll-Month, dated the 1st of
// that month, with its Taken figure as totalDays. Each one commits its
// balance and records Loss of Pay exactly like a real HOD/Principal approval
// would (see splitLeaveDays/commitApproval) - OPB/CLB are never read from the
// file, they're always derived live from what actually got committed here,
// same as the Export/on-screen register. College Office owns this (see
// AGENTS.md's leave module note) - Principal/VP can too, same as every other
// college-wide leave surface.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL");
    const body = (await readJsonBody(request)) as { records: ImportRow[] };

    if (!body.records || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }
    if (body.records.length > 500) {
      return NextResponse.json({ error: "Maximum 500 records per import" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;

    const lookup = await loadStaffLookup(db, collegeId);
    const { namesByUid } = lookup;

    let addedByName = "College Office";
    try {
      const addedBySnap = await db.collection("colleges").doc(collegeId).collection("users").doc(session.uid).get();
      addedByName = (addedBySnap.data() as { name?: string } | undefined)?.name ?? addedByName;
    } catch { /* best-effort */ }

    const failed: { row: number; identifier: string; error: string }[] = [];
    const tasks: ImportTask[] = [];

    for (let i = 0; i < body.records.length; i++) {
      const row = body.records[i];
      const rowNum = i + 2; // 1-indexed + header row
      const rawEmployeeId = row.employeeId?.trim() ?? "";
      const rawName = row.employeeName?.trim() ?? "";
      const identifier = rawEmployeeId || rawName || "-";

      const uid = resolveStaffUid(lookup, rawEmployeeId, rawName);
      if (!uid) {
        failed.push({ row: rowNum, identifier, error: `No staff login account found matching "${identifier}" - check spelling/ID, or set up their login first` });
        continue;
      }

      const period = parsePayrollMonth(row.payrollMonth);
      if (!period) {
        failed.push({ row: rowNum, identifier, error: `Payroll Month must be a valid month/year (e.g. "June 2025"), got "${row.payrollMonth}"` });
        continue;
      }

      for (const { key, code } of IMPORT_TYPE_KEYS) {
        const days = parseDays(row[key]);
        if (days > 0) tasks.push({ row: rowNum, identifier, uid, code, year: period.year, month: period.month, days });
      }
    }

    // Oldest Payroll Month first, per employee - so a balance depleted by an
    // earlier month is already reflected when a later month's figure is
    // split into within-balance/Loss-of-Pay, regardless of upload order.
    sortImportTasks(tasks);

    const created = await commitImportTasks(db, collegeId, { uid: session.uid, name: addedByName }, namesByUid, tasks, failed);

    if (created > 0) {
      await writeAuditLogSafe(db, collegeId, { action: "LEAVE_HISTORY_IMPORTED", performedBy: session.uid, performedByName: addedByName, details: { created, failed: failed.length } });
    }

    return NextResponse.json({ created, failed }, { status: 201 });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/leave-history-report/import POST]", err);
    const detail = process.env.NODE_ENV !== "production" ? `: ${err instanceof Error ? err.message : String(err)}` : "";
    return NextResponse.json({ error: `Internal error${detail}` }, { status: 500 });
  }
}
