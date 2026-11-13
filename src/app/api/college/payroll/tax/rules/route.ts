export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { cleanTaxRules, defaultTaxRules } from "@/lib/payroll/tax";
import { fyFrom, taxRefs } from "@/lib/payroll/taxServer";
import { PayrollError, loadPayrollSettings, payrollErrorResponse, requirePayrollAccounts } from "@/lib/payroll/server";
import type { PayrollTaxRules } from "@/types/payroll";

// Income-tax rules of a financial year (?fy=2026-27), per college, Accounts only. Until Accounts save
// (confirm) them, no TDS is worked out for that year - the defaults shown are the FY 2026-27 values.

const badFy = (err: unknown) => err instanceof Error && err.message === "BAD_FY" ? NextResponse.json({ error: "Enter the financial year as YYYY-YY, for example 2026-27." }, { status: 400 }) : null;

export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollAccounts(db, request);
    const fy = fyFrom(request);
    const snap = await taxRefs(db, session.collegeId).rules.doc(fy).get();
    const { settings } = await loadPayrollSettings(db, session.collegeId);
    return NextResponse.json({ fy, saved: snap.exists, rules: snap.exists ? snap.data() : defaultTaxRules(fy), earnings: settings.earnings.map((e) => ({ id: e.id, label: e.label })) });
  } catch (err) {
    return badFy(err) ?? payrollErrorResponse(err, "[college/payroll/tax/rules GET]");
  }
}

export async function PUT(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollAccounts(db, request);
    const fy = fyFrom(request);
    const body = (await readJsonBody(request)) as { rules?: unknown; version?: unknown };
    const { settings } = await loadPayrollSettings(db, session.collegeId);
    const clean = cleanTaxRules(body.rules, fy, settings.earnings.map((e) => e.id));
    const ref = taxRefs(db, session.collegeId).rules.doc(fy);
    const saved = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const version = snap.exists ? (snap.data() as PayrollTaxRules).version : 0;
      if (Number(body.version ?? -1) !== version) throw new PayrollError("Someone else changed these rules - reload and try again", 409);
      const next: PayrollTaxRules = { ...clean, version: version + 1, updatedAt: new Date().toISOString(), updatedByName: session.email };
      tx.set(ref, next);
      return next;
    });
    await writeAuditLogSafe(db, session.collegeId, { action: "PAYROLL_TAX_RULES_SAVED", performedBy: session.uid, performedByName: session.email, targetId: fy, details: { fy, version: saved.version } });
    return NextResponse.json({ rules: saved });
  } catch (err) {
    return badFy(err) ?? payrollErrorResponse(err, "[college/payroll/tax/rules PUT]");
  }
}
