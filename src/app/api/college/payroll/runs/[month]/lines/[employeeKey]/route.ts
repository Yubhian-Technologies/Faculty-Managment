export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { isMonthKey } from "@/lib/payroll/rules";
import { applyLineEdit, canEditLines } from "@/lib/payroll/run";
import { priceWithTax } from "@/lib/payroll/lineTax";
import { loadPersonTaxContext } from "@/lib/payroll/taxServer";
import { runRefs, swapLineInTotals } from "@/lib/payroll/runServer";
import { PayrollError, payrollErrorResponse, requirePayrollActor } from "@/lib/payroll/server";
import type { PayrollLine, PayrollRun } from "@/types/payroll";

// Changes one line of an open month: { rev, edit: { lopOverride, notCredited, hold, oneOffs, manual, tds*, advance* } }
// (* Accounts only). Re-prices the line and the month's totals in one transaction; every change is kept
// in the line's history.

const KEY_RE = /^(FACULTY|STAFF)_[A-Za-z0-9_-]{1,128}$/;

export async function PATCH(request: Request, { params }: { params: Promise<{ month: string; employeeKey: string }> }) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollActor(db, request);
    const { month, employeeKey } = await params;
    if (!isMonthKey(month) || !KEY_RE.test(employeeKey)) throw new PayrollError("Not found", 404);
    const body = (await readJsonBody(request)) as { rev?: unknown; edit?: unknown };
    const refs = runRefs(db, session.collegeId, month);
    const at = new Date().toISOString();
    // The person's tax context (rules, profile, released months) - read outside the transaction; it only
    // changes on a release or an Accounts edit, both of which bump what the client must reload.
    const runNow = (await refs.run.get()).data() as PayrollRun | undefined;
    if (!runNow) throw new PayrollError("Not found", 404);
    const taxCtx = await loadPersonTaxContext(db, session.collegeId, month, employeeKey, runNow.settings);

    const out = await db.runTransaction(async (tx) => {
      const [runSnap, lineSnap] = await Promise.all([tx.get(refs.run), tx.get(refs.lines.doc(employeeKey))]);
      if (!runSnap.exists || !lineSnap.exists) throw new PayrollError("Not found", 404);
      const run = runSnap.data() as PayrollRun;
      if (Number(body.rev ?? -1) !== run.rev) throw new PayrollError("This month changed since you opened it - reload and try again", 409);
      if (!canEditLines(run.status, session.actor)) throw new PayrollError(`The month is ${run.status.toLowerCase()} - lines can't be changed`, 409);
      const old = lineSnap.data() as PayrollLine;
      const { line, changes } = applyLineEdit(old, body.edit, run.settings, session.actor, { byName: session.email, at });
      const priced = priceWithTax({ ...line, history: [...old.history, ...changes.map((change) => ({ at, byName: session.email, change }))].slice(-50) },
        { ...run.settings, tdsRoundTo: run.settings.tdsRoundTo ?? 100 }, month, taxCtx);
      const next: PayrollRun = { ...run, totals: swapLineInTotals(run.totals, old, priced), rev: run.rev + 1 };
      tx.set(refs.lines.doc(employeeKey), priced);
      tx.set(refs.run, next);
      return { line: priced, totals: next.totals, rev: next.rev, changes };
    });
    await writeAuditLogSafe(db, session.collegeId, {
      action: "PAYROLL_LINE_UPDATED", performedBy: session.uid, performedByName: session.email, targetId: `${month}/${employeeKey}`,
      details: { month, employeeKey, changes: out.changes },
    });
    return NextResponse.json(out);
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/runs/[month]/lines/[employeeKey] PATCH]");
  }
}
