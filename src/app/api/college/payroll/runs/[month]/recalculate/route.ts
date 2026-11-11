export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { isMonthKey, monthDays } from "@/lib/payroll/rules";
import { canEditLines, runTotals } from "@/lib/payroll/run";
import { buildRun, runRefs, runSettingsSnapshot } from "@/lib/payroll/runServer";
import { PayrollError, payrollErrorResponse, requirePayrollActor } from "@/lib/payroll/server";
import type { PayrollLine, PayrollRun } from "@/types/payroll";

// Re-works a month from the latest pay structures, rules, leave and attendance while it is still open
// (DRAFT / RETURNED; Accounts also while SUBMITTED). What people set on a line is kept; new joiners are
// added and people no longer in the month are dropped. Returns how many lines changed.

export async function POST(request: Request, { params }: { params: Promise<{ month: string }> }) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollActor(db, request);
    const { month } = await params;
    if (!isMonthKey(month)) throw new PayrollError("Not found", 404);
    const { rev } = (await readJsonBody(request)) as { rev?: unknown };
    const refs = runRefs(db, session.collegeId, month);
    const [runSnap, lineSnap] = await Promise.all([refs.run.get(), refs.lines.get()]);
    if (!runSnap.exists) throw new PayrollError("Not prepared yet", 404);
    const before = runSnap.data() as PayrollRun;
    if (!canEditLines(before.status, session.actor)) throw new PayrollError(`The month is ${before.status.toLowerCase()} - it can't be recalculated`, 409);
    const previous = new Map(lineSnap.docs.map((d) => [d.id, d.data() as PayrollLine]));
    const built = await buildRun(db, session.collegeId, month, previous);
    const at = new Date().toISOString();

    const keep = new Set(built.lines.map((l) => l.employeeKey));
    const changed = built.lines.filter((l) => {
      const p = previous.get(l.employeeKey);
      return !p || p.result.net !== l.result.net || p.payDays !== l.payDays || p.result.gross !== l.result.gross;
    }).length;
    const removed = [...previous.keys()].filter((k) => !keep.has(k)).length;

    const next = await db.runTransaction(async (tx) => {
      const snap = await tx.get(refs.run);
      const cur = snap.data() as PayrollRun;
      if (Number(rev ?? -1) !== cur.rev) throw new PayrollError("This month changed since you opened it - reload and try again", 409);
      if (!canEditLines(cur.status, session.actor)) throw new PayrollError("The month can't be recalculated now", 409);
      const run: PayrollRun = {
        ...cur, monthDays: monthDays(month, built.settings.payDayBasis), settings: runSettingsSnapshot(built.settings),
        totals: runTotals(built.lines), excluded: built.excluded, taxRulesConfirmed: built.taxRulesConfirmed, rev: cur.rev + 1, calculatedAt: at,
        history: [...cur.history, { action: "RECALCULATED", byName: session.email, byUid: session.uid, at, remarks: `${changed} changed, ${removed} removed` }],
      };
      tx.set(refs.run, run);
      return run;
    });
    const batch = new ChunkedBatch(db);
    for (const l of built.lines) batch.set(refs.lines.doc(l.employeeKey), l);
    for (const k of previous.keys()) if (!keep.has(k)) batch.delete(refs.lines.doc(k));
    await batch.commit();
    await writeAuditLogSafe(db, session.collegeId, {
      action: "PAYROLL_RUN_RECALCULATED", performedBy: session.uid, performedByName: session.email, targetId: month,
      details: { month, changed, removed, net: next.totals.net },
    });
    return NextResponse.json({ changed, removed, added: built.lines.filter((l) => !previous.has(l.employeeKey)).length, rev: next.rev });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/runs/[month]/recalculate POST]");
  }
}
