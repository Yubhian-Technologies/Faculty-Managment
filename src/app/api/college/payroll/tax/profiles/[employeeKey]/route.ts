export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { cleanTaxProfile, emptyTaxProfile } from "@/lib/payroll/tax";
import { fyFrom, profileId, taxRefs } from "@/lib/payroll/taxServer";
import { PayrollError, listPayEmployees, payrollErrorResponse, requirePayrollAccounts } from "@/lib/payroll/server";
import type { PayrollTaxProfile } from "@/types/payroll";

// Accounts save a person's tax profile for a financial year: { rev, profile: { regime, declarations,
// otherIncome, previousEmployer, opening? } }. A change reaches an open month on Recalculate and is
// spread over the months left.

const KEY_RE = /^(FACULTY|STAFF)_[A-Za-z0-9_-]{1,128}$/;

export async function PUT(request: Request, { params }: { params: Promise<{ employeeKey: string }> }) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollAccounts(db, request);
    const fy = fyFrom(request);
    const { employeeKey } = await params;
    if (!KEY_RE.test(employeeKey)) throw new PayrollError("Not found", 404);
    if (!(await listPayEmployees(db, session.collegeId)).some((e) => e.employeeKey === employeeKey)) throw new PayrollError("Not found", 404);
    const body = (await readJsonBody(request)) as { rev?: unknown; profile?: unknown };
    const clean = cleanTaxProfile(body.profile, fy);
    const ref = taxRefs(db, session.collegeId).profiles.doc(profileId(fy, employeeKey));
    const at = new Date().toISOString();
    const saved = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.exists ? (snap.data() as PayrollTaxProfile) : emptyTaxProfile(employeeKey, fy);
      if (Number(body.rev ?? -1) !== cur.rev) throw new PayrollError("Someone else changed this - reload and try again", 409);
      const change = cur.regime !== clean.regime ? `Regime ${cur.regime} -> ${clean.regime}` : "Declarations / figures updated";
      const next: PayrollTaxProfile = { ...cur, ...clean, rev: cur.rev + 1, updatedAt: at, updatedByName: session.email, history: [...(cur.history ?? []), { at, byName: session.email, change }].slice(-50) };
      if (!clean.opening) delete next.opening;
      tx.set(ref, next);
      return next;
    });
    await writeAuditLogSafe(db, session.collegeId, { action: "PAYROLL_TAX_PROFILE_SAVED", performedBy: session.uid, performedByName: session.email, targetId: `${fy}/${employeeKey}`, details: { fy, employeeKey, regime: saved.regime } });
    return NextResponse.json({ profile: saved });
  } catch (err) {
    if (err instanceof Error && err.message === "BAD_FY") return NextResponse.json({ error: "Enter the financial year as YYYY-YY, for example 2026-27." }, { status: 400 });
    return payrollErrorResponse(err, "[college/payroll/tax/profiles/[employeeKey] PUT]");
  }
}
