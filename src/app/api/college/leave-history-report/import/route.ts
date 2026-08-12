export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getOrCreateProfile } from "@/lib/leave/profile";
import { REQUESTS_COL, commitApproval, splitLeaveDays } from "@/lib/leave/balanceEngine";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import type { EmployeeLeaveProfile, LeaveActionRecord, LeaveRequest, LeaveTypeCode } from "@/types/leave";
import type { UserRole } from "@/types";

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

// Excludes STUDENT/CLASS_LEADER when matching a row's identifier to a login -
// they never have a leave profile (see lib/leave/identity.ts).
const NON_STAFF_ROLES: UserRole[] = ["STUDENT", "CLASS_LEADER"];

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
}

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

interface ImportTask {
  row: number;
  identifier: string;
  uid: string;
  code: LeaveTypeCode;
  year: number;
  month: number; // 1-12
  days: number;
}

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
    const body = (await request.json()) as { records: ImportRow[] };

    if (!body.records || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }
    if (body.records.length > 500) {
      return NextResponse.json({ error: "Maximum 500 records per import" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;

    const usersSnap = await db.collection("colleges").doc(collegeId).collection("users").get();
    const byEmployeeId = new Map<string, string>();
    const byNormalizedName = new Map<string, string>();
    const namesByUid = new Map<string, string>();
    for (const doc of usersSnap.docs) {
      const data = doc.data() as { name?: string; employeeId?: string; role?: UserRole };
      if (!data.role || NON_STAFF_ROLES.includes(data.role)) continue;
      if (data.employeeId?.trim()) byEmployeeId.set(data.employeeId.trim().toLowerCase(), doc.id);
      if (data.name) {
        namesByUid.set(doc.id, data.name);
        const key = normalizeName(data.name);
        if (!byNormalizedName.has(key)) byNormalizedName.set(key, doc.id); // first match wins on duplicate names
      }
    }

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

      const uid = (rawEmployeeId && byEmployeeId.get(rawEmployeeId.toLowerCase()))
        || (rawName && byNormalizedName.get(normalizeName(rawName)))
        || undefined;
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
    tasks.sort((a, b) => a.uid.localeCompare(b.uid) || a.year - b.year || a.month - b.month);

    const now = new Date();
    const profileCache = new Map<string, EmployeeLeaveProfile | null>();
    let created = 0;

    for (const task of tasks) {
      let profile = profileCache.get(task.uid);
      if (profile === undefined) {
        profile = await getOrCreateProfile(db, collegeId, task.uid);
        profileCache.set(task.uid, profile);
      }
      if (!profile) {
        failed.push({ row: task.row, identifier: task.identifier, error: "Employee record not found" });
        continue;
      }

      let lopDays = 0;
      const lt = LEAVE_TYPE_SEED.find((t) => t.code === task.code);
      if (lt && !lt.rules.unlimited) {
        const split = await splitLeaveDays(db, collegeId, task.uid, lt, task.year, task.days);
        lopDays = split.lopDays;
        if (split.withinBalance > 0) {
          await commitApproval(db, collegeId, task.uid, task.code, task.year, split.withinBalance);
        }
      }

      const actionRecord: LeaveActionRecord = {
        action: "APPROVED",
        by: session.uid,
        byName: addedByName,
        at: now as unknown as LeaveActionRecord["at"],
        remarks: "Imported historical record",
      };

      const fromDate = new Date(task.year, task.month - 1, 1);
      const newRequest: Omit<LeaveRequest, "id"> = {
        collegeId,
        uid: task.uid,
        employeeName: namesByUid.get(task.uid) ?? task.identifier,
        ...(profile.department ? { department: profile.department } : {}),
        leaveTypeCode: task.code,
        isOtherRequest: false,
        fromDate: fromDate as unknown as LeaveRequest["fromDate"],
        toDate: fromDate as unknown as LeaveRequest["toDate"],
        totalDays: task.days,
        reason: "Imported record",
        status: "APPROVED",
        lopDays,
        hodAction: actionRecord,
        createdAt: now as unknown as LeaveRequest["createdAt"],
        updatedAt: now as unknown as LeaveRequest["updatedAt"],
      };

      await REQUESTS_COL(collegeId, db).add(newRequest);
      created++;
    }

    if (created > 0) {
      await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
        collegeId,
        action: "LEAVE_HISTORY_IMPORTED",
        performedBy: session.uid,
        performedByName: addedByName,
        details: { created, failed: failed.length },
        timestamp: now,
      });
    }

    return NextResponse.json({ created, failed }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/leave-history-report/import POST]", err);
    const detail = process.env.NODE_ENV !== "production" ? `: ${err instanceof Error ? err.message : String(err)}` : "";
    return NextResponse.json({ error: `Internal error${detail}` }, { status: 500 });
  }
}
