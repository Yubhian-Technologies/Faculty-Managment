export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { istDateKey } from "@/lib/attendance/istTime";
import { isMonthKey, monthDays } from "@/lib/payroll/rules";
import { runTotals } from "@/lib/payroll/run";
import { buildRun, runRefs, runSettingsSnapshot } from "@/lib/payroll/runServer";
import { PayrollError, payrollErrorResponse, payrollRefs, requirePayrollActor, requirePayrollRunReader } from "@/lib/payroll/server";
import type { PayrollRun } from "@/types/payroll";

// A college's monthly runs: GET lists them (status + totals); POST { month } - the College Office
// prepares a month (a DRAFT with every line worked out from pay, leave and attendance).

export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollRunReader(db, request);
    const snap = await payrollRefs(db, session.collegeId).runs.get();
    const runs = snap.docs.map((d) => {
      const r = d.data() as PayrollRun;
      return { month: d.id, status: r.status, totals: r.totals, excludedCount: r.excluded?.length ?? 0, calculatedAt: r.calculatedAt, release: r.release ?? null, returnRemarks: r.returnRemarks ?? null };
    }).sort((a, b) => b.month.localeCompare(a.month));
    return NextResponse.json({ runs, role: session.role });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/runs GET]");
  }
}

export async function POST(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollActor(db, request);
    if (session.actor !== "OFFICE" && !session.superAdmin) throw new PayrollError("The College Office prepares the month", 403);
    const { month } = (await readJsonBody(request)) as { month?: unknown };
    if (!isMonthKey(month)) throw new PayrollError("Pick a month");
    const now = istDateKey().slice(0, 7);
    const [ny, nm] = now.split("-").map(Number);
    const next = nm === 12 ? `${ny + 1}-01` : `${ny}-${String(nm + 1).padStart(2, "0")}`;
    if (month > next) throw new PayrollError("That month is too far ahead");

    const built = await buildRun(db, session.collegeId, month);
    if (built.lines.length === 0) throw new PayrollError("Nobody has pay set for that month - Accounts set pay structures first");
    const refs = runRefs(db, session.collegeId, month);
    const at = new Date().toISOString();
    const run: PayrollRun = {
      month, status: "DRAFT", monthDays: monthDays(month, built.settings.payDayBasis), settings: runSettingsSnapshot(built.settings),
      totals: runTotals(built.lines), excluded: built.excluded, taxRulesConfirmed: built.taxRulesConfirmed, rev: 1, calculatedAt: at,
      history: [{ action: "PREPARED", byName: session.email, byUid: session.uid, at }],
    };
    await db.runTransaction(async (tx) => {
      if ((await tx.get(refs.run)).exists) throw new PayrollError(`${month} is already prepared`, 409);
      tx.set(refs.run, run);
    });
    const batch = new ChunkedBatch(db);
    for (const l of built.lines) batch.set(refs.lines.doc(l.employeeKey), l);
    await batch.commit();
    await writeAuditLogSafe(db, session.collegeId, {
      action: "PAYROLL_RUN_PREPARED", performedBy: session.uid, performedByName: session.email, targetId: month,
      details: { month, lines: built.lines.length, net: run.totals.net },
    });
    return NextResponse.json({ month, totals: run.totals });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/runs POST]");
  }
}
