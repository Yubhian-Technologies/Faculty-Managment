export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { isMonthKey } from "@/lib/payroll/rules";
import { applyLineEdit, canEditLines } from "@/lib/payroll/run";
import { priceWithTax } from "@/lib/payroll/lineTax";
import { planMonthlyDeductions } from "@/lib/payroll/monthlyDeductions";
import { loadTaxContexts } from "@/lib/payroll/taxServer";
import { runRefs, swapLineInTotals } from "@/lib/payroll/runServer";
import { PayrollError, payrollErrorResponse, requirePayrollActor } from "@/lib/payroll/server";
import type { ImportRow } from "@/lib/payroll/pay";
import type { PayrollLine, PayrollRun } from "@/types/payroll";

// A month's deductions entered each month (MediClaim ...) from a file: { mode: preview | apply, rev, headers, rows }.
// "preview" writes nothing; "apply" saves only when the whole file is clean - every changed line re-priced (tax
// included) and the month's totals, in one transaction, each line's history saying what changed.
// Same people and states as editing one line (College Office / Accounts, open month).

const MAX_ROWS = 2000;
const MAX_CHANGED = 450;   // lines + the month in one transaction (Firestore's 500 writes)

export async function POST(request: Request, { params }: { params: Promise<{ month: string }> }) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollActor(db, request);
    const { month } = await params;
    if (!isMonthKey(month)) throw new PayrollError("Not found", 404);
    const body = (await readJsonBody(request)) as { mode?: unknown; rev?: unknown; headers?: unknown; rows?: unknown };
    const mode = body.mode === "apply" ? "apply" : "preview";
    if (!Array.isArray(body.headers) || !Array.isArray(body.rows)) throw new PayrollError("The file has no rows");
    if (body.rows.length > MAX_ROWS) throw new PayrollError(`At most ${MAX_ROWS} rows per file`);
    const headers = body.headers.map((h) => String(h ?? "").trim());
    const rows: ImportRow[] = (body.rows as unknown[]).map((r, i) => {
      const o = (r ?? {}) as { row?: unknown; code?: unknown; values?: unknown };
      const values = (o.values && typeof o.values === "object" ? o.values : {}) as Record<string, unknown>;
      return { row: Number(o.row) || i + 2, code: String(o.code ?? ""), values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v ?? "")])) };
    });

    const refs = runRefs(db, session.collegeId, month);
    const [runSnap, linesSnap] = await Promise.all([refs.run.get(), refs.lines.get()]);
    if (!runSnap.exists) throw new PayrollError("Not found", 404);
    const runNow = runSnap.data() as PayrollRun;
    if (!canEditLines(runNow.status, session.actor)) throw new PayrollError(`The month is ${runNow.status.toLowerCase()} - lines can't be changed`, 409);
    const plan = planMonthlyDeductions(headers, rows, linesSnap.docs.map((d) => d.data() as PayrollLine), runNow.settings);
    const changed = plan.rows.filter((r) => r.status === "CHANGED");
    if (changed.length > MAX_CHANGED) throw new PayrollError(`At most ${MAX_CHANGED} people per file - split it`);
    if (mode === "preview" || plan.errors > 0) {
      return NextResponse.json({ ...plan, applied: 0 }, { status: mode === "apply" && plan.errors > 0 ? 400 : 200 });
    }
    if (changed.length === 0) return NextResponse.json({ ...plan, applied: 0 });

    const at = new Date().toISOString();
    const tax = await loadTaxContexts(db, session.collegeId, month, runNow.settings);
    const applied = await db.runTransaction(async (tx) => {
      const runDoc = await tx.get(refs.run);
      const run = runDoc.data() as PayrollRun | undefined;
      if (!run) throw new PayrollError("Not found", 404);
      if (Number(body.rev ?? -1) !== run.rev) throw new PayrollError("This month changed since you opened it - reload and try again", 409);
      if (!canEditLines(run.status, session.actor)) throw new PayrollError(`The month is ${run.status.toLowerCase()} - lines can't be changed`, 409);
      const docs = await Promise.all(changed.map((r) => tx.get(refs.lines.doc(r.employeeKey!))));
      let totals = run.totals;
      const writes: PayrollLine[] = [];
      for (const [i, snap] of docs.entries()) {
        if (!snap.exists) throw new PayrollError("This month changed since you opened it - reload and try again", 409);
        const old = snap.data() as PayrollLine;
        const { line, changes } = applyLineEdit(old, { manual: changed[i].after }, run.settings, session.actor, { byName: session.email, at });
        const priced = priceWithTax({ ...line, history: [...old.history, ...changes.map((change) => ({ at, byName: session.email, change: `${change} (from a file)` }))].slice(-50) },
          { ...run.settings, tdsRoundTo: run.settings.tdsRoundTo ?? 100 }, month, tax.contextFor(old.employeeKey));
        totals = swapLineInTotals(totals, old, priced);
        writes.push(priced);
      }
      for (const l of writes) tx.set(refs.lines.doc(l.employeeKey), l);
      tx.set(refs.run, { ...run, totals, rev: run.rev + 1 });
      return writes.length;
    });
    await writeAuditLogSafe(db, session.collegeId, {
      action: "PAYROLL_LINE_UPDATED", performedBy: session.uid, performedByName: session.email, targetId: `${month}/deductions-import`,
      details: { month, via: "Monthly deductions file", columns: plan.columns.map((c) => c.label), people: applied },
    });
    return NextResponse.json({ ...plan, applied });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/runs/[month]/deductions-import POST]");
  }
}
