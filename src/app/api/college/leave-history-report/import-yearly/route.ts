export const dynamic = "force-dynamic";

import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  commitImportTasks, loadImportedKeys, loadStaffLookup, resolveStaffUid, sortImportTasks, type ImportTask,
} from "@/lib/leave/historyImport";
import { MONTH_ABBR, YEARLY_RECORDS_COL, planYearlyRow } from "@/lib/leave/yearlyImport";

// Year-wise Leave History import (see lib/leave/yearlyImport.ts): one row per employee per
// calendar year with that year's Weekly Offs, Holidays and CL/SL/EL/VC (Total + Jan-Dec).
// Leave is recorded exactly like the monthly import (already-APPROVED, balance and Loss of Pay
// committed in oldest-first order); Weekly Offs / Holidays are kept per employee-year in
// leaveYearlyRecords/{uid}_{year} and shown by the Yearly leave report. College Office owns
// this; Principal/VP can too, same as the monthly import.
type YearlyRow = Record<string, string | undefined>;

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL");
    const body = (await readJsonBody(request)) as { records: YearlyRow[] };

    if (!body.records || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }
    if (body.records.length > 500) {
      return NextResponse.json({ error: "Maximum 500 records per import" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;
    const lookup = await loadStaffLookup(db, collegeId);

    let addedByName = "College Office";
    try {
      const addedBySnap = await db.collection("colleges").doc(collegeId).collection("users").doc(session.uid).get();
      addedByName = (addedBySnap.data() as { name?: string } | undefined)?.name ?? addedByName;
    } catch { /* best-effort */ }

    const failed: { row: number; identifier: string; error: string }[] = [];
    const tasks: ImportTask[] = [];
    const yearly: { uid: string; year: number; weeklyOffs?: number; holidays?: number }[] = [];
    // A (employee, year) given on two rows would double its leave - the second is refused.
    const seenEmployeeYear = new Set<string>();

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
      const plan = planYearlyRow(row);
      if (!plan.ok) {
        failed.push({ row: rowNum, identifier, error: plan.error });
        continue;
      }
      const ey = `${uid}|${plan.year}`;
      if (seenEmployeeYear.has(ey)) {
        failed.push({ row: rowNum, identifier, error: `${identifier} already has a row for ${plan.year} in this file` });
        continue;
      }
      seenEmployeeYear.add(ey);

      yearly.push({ uid, year: plan.year, weeklyOffs: plan.weeklyOffs, holidays: plan.holidays });
      for (const t of plan.tasks) {
        tasks.push({ row: rowNum, identifier, uid, code: t.code, year: plan.year, month: t.month, days: t.days });
      }
    }

    // A month already imported for the same employee and leave type is skipped, not doubled.
    const already = await loadImportedKeys(db, collegeId, tasks.map((t) => t.uid));
    const fresh = tasks.filter((t) => {
      if (!already.has(`${t.uid}|${t.code}|${t.year}|${t.month}`)) return true;
      failed.push({ row: t.row, identifier: t.identifier, error: `${t.code} for ${MONTH_ABBR[t.month - 1]} ${t.year} was already imported - skipped` });
      return false;
    });
    sortImportTasks(fresh);

    const created = await commitImportTasks(db, collegeId, { uid: session.uid, name: addedByName }, lookup.namesByUid, fresh, failed);

    // Weekly Offs / Holidays per employee-year (only what the row gave; a blank leaves any earlier value alone).
    const now = new Date();
    let yearlyRecords = 0;
    for (const y of yearly) {
      if (y.weeklyOffs == null && y.holidays == null) continue;
      await db.collection("colleges").doc(collegeId).collection(YEARLY_RECORDS_COL).doc(`${y.uid}_${y.year}`).set({
        collegeId, uid: y.uid, year: y.year,
        ...(y.weeklyOffs != null ? { weeklyOffs: y.weeklyOffs } : {}),
        ...(y.holidays != null ? { holidays: y.holidays } : {}),
        importedBy: session.uid, importedAt: now,
      }, { merge: true });
      yearlyRecords++;
    }

    if (created > 0 || yearlyRecords > 0) {
      await writeAuditLogSafe(db, collegeId, {
        action: "LEAVE_HISTORY_IMPORTED", performedBy: session.uid, performedByName: addedByName,
        details: { mode: "yearly", created, yearlyRecords, failed: failed.length },
      });
    }

    return NextResponse.json({ created: created + yearlyRecords, leaveRecords: created, yearlyRecords, failed }, { status: 201 });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/leave-history-report/import-yearly POST]", err);
    const detail = process.env.NODE_ENV !== "production" ? `: ${err instanceof Error ? err.message : String(err)}` : "";
    return NextResponse.json({ error: `Internal error${detail}` }, { status: 500 });
  }
}
