export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { cleanPayrollSettings } from "@/lib/payroll/rules";
import { PayrollError, loadPayrollSettings, payrollErrorResponse, payrollRefs, requirePayrollAccounts, requirePayrollReader } from "@/lib/payroll/server";
import type { PayrollSettings } from "@/types/payroll";

// The college's pay parts and deduction rules. Accounts maintain them; the College Office reads them.
// A college with nothing saved gets the defaults (the VWU sheet's rules) until Accounts save.

export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollReader(db, request);
    const { settings, saved } = await loadPayrollSettings(db, session.collegeId);
    return NextResponse.json({ settings, saved, canEdit: session.role !== "COLLEGE_OFFICE" });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/settings GET]");
  }
}

export async function PUT(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollAccounts(db, request);
    const body = (await readJsonBody(request)) as { settings?: unknown; version?: unknown };
    const ref = payrollRefs(db, session.collegeId).settings;
    const next = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const prev = snap.exists ? (snap.data() as PayrollSettings) : null;
      const version = prev?.version ?? 0;
      if (Number(body.version ?? -1) !== version) throw new PayrollError("Someone else changed these rules - reload and try again", 409);
      const clean = cleanPayrollSettings(body.settings, prev);
      const saved: PayrollSettings = { ...clean, version: version + 1, updatedAt: new Date().toISOString(), updatedByName: session.email };
      tx.set(ref, saved);
      return saved;
    });
    await writeAuditLogSafe(db, session.collegeId, {
      action: "PAYROLL_SETTINGS_UPDATED", performedBy: session.uid, performedByName: session.email, targetId: "payrollSettings",
      details: { version: next.version, earnings: next.earnings.map((e) => e.id), deductions: next.deductions.map((d) => d.id) },
    });
    return NextResponse.json({ settings: next });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/settings PUT]");
  }
}
