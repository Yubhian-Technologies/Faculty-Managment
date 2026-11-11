export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { isMonthKey } from "@/lib/payroll/rules";
import { isRunAction, moveRun } from "@/lib/payroll/run";
import { ledgerDoc, ledgerDocId, notifyPayroll, recordAdvanceRecoveries, runRefs } from "@/lib/payroll/runServer";
import { PayrollError, payrollErrorResponse, requirePayrollActor, requirePayrollRunReader } from "@/lib/payroll/server";
import type { PayrollLine, PayrollRun, PayrollRunStatus } from "@/types/payroll";

// One month: GET the run with every line (Accounts, College Office, Principal / VP read);
// POST { action, rev, remarks?, paidOn?, reference? } moves it - SUBMIT (Office), RETURN / APPROVE /
// REOPEN / RELEASE (Accounts); DELETE removes a DRAFT (Office).
// RELEASE locks the month for good and writes each paid person's ledger entry for the financial year
// and records the advance recoveries (RELEASING while that runs - re-sending RELEASE finishes it; the
// writes are idempotent).

type Ctx = { params: Promise<{ month: string }> };

async function monthOf(params: Ctx["params"]) {
  const { month } = await params;
  if (!isMonthKey(month)) throw new PayrollError("Not found", 404);
  return month;
}

export async function GET(request: Request, { params }: Ctx) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollRunReader(db, request);
    const month = await monthOf(params);
    const refs = runRefs(db, session.collegeId, month);
    const [runSnap, lineSnap, collegeSnap] = await Promise.all([refs.run.get(), refs.lines.get(), db.collection("colleges").doc(session.collegeId).get()]);
    if (!runSnap.exists) throw new PayrollError("Not prepared yet", 404);
    const collegeName = String((collegeSnap.data() as { name?: string } | undefined)?.name ?? "College");
    const lines = lineSnap.docs.map((d) => d.data() as PayrollLine)
      .sort((a, b) => a.section.localeCompare(b.section) || a.employeeCode.localeCompare(b.employeeCode, undefined, { numeric: true }));
    const actor = session.role === "COLLEGE_OFFICE" ? "OFFICE" : session.role === "ACCOUNTS" || session.role === "SUPER_ADMIN" ? "ACCOUNTS" : "VIEWER";
    return NextResponse.json({ run: runSnap.data() as PayrollRun, lines, actor, collegeName, superAdmin: session.role === "SUPER_ADMIN" });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/runs/[month] GET]");
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollActor(db, request);
    const month = await monthOf(params);
    const body = (await readJsonBody(request)) as { action?: unknown; rev?: unknown; remarks?: unknown; paidOn?: unknown; reference?: unknown };
    if (!isRunAction(body.action)) throw new PayrollError("Unknown action");
    const action = body.action;
    const remarks = typeof body.remarks === "string" ? body.remarks.trim().slice(0, 1000) : "";
    if (action === "RETURN" && !remarks) throw new PayrollError("Say what needs fixing");
    const paidOn = typeof body.paidOn === "string" ? body.paidOn : "";
    const reference = typeof body.reference === "string" ? body.reference.trim().slice(0, 120) : "";
    if (action === "RELEASE" && (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || !reference)) throw new PayrollError("Give the payment date and the bank reference");

    const refs = runRefs(db, session.collegeId, month);
    const at = new Date().toISOString();
    const event = { action, byName: session.email, byUid: session.uid, at, ...(remarks ? { remarks } : {}) };

    // Status move (RELEASE first goes to RELEASING; a RELEASING run just finishes below).
    const run = await db.runTransaction(async (tx) => {
      const snap = await tx.get(refs.run);
      if (!snap.exists) throw new PayrollError("Not prepared yet", 404);
      const cur = snap.data() as PayrollRun;
      if (Number(body.rev ?? -1) !== cur.rev) throw new PayrollError("This month changed since you opened it - reload and try again", 409);
      if (action === "RELEASE" && cur.status === "RELEASING") return cur;
      const to = moveRun(cur.status, action, session.actor, cur.totals, session.superAdmin);
      const status: PayrollRunStatus = to === "RELEASED" ? "RELEASING" : to;
      const next: PayrollRun = {
        ...cur, status, rev: cur.rev + 1, history: [...cur.history, event],
        ...(action === "RETURN" ? { returnRemarks: remarks } : {}),
        ...(action === "RELEASE" ? { release: { paidOn, reference, at, byName: session.email } } : {}),
      };
      if (action === "SUBMIT") delete next.returnRemarks;
      tx.set(refs.run, next);
      return next;
    });

    let lines: PayrollLine[] = [];
    if (action === "RELEASE") {
      lines = (await refs.lines.get()).docs.map((d) => d.data() as PayrollLine);
      const batch = new ChunkedBatch(db);
      for (const l of lines) {
        if (l.hold || l.notCredited || l.result.gross <= 0) continue;
        batch.set(refs.ledger.doc(ledgerDocId(l.employeeKey, month)), ledgerDoc(l, month, run.settings));
      }
      await batch.commit();
      await recordAdvanceRecoveries(db, session.collegeId, month, lines, run.settings, at, session.email);
      await refs.run.update({ status: "RELEASED", rev: run.rev + 1 });
    }

    await writeAuditLogSafe(db, session.collegeId, {
      action: `PAYROLL_RUN_${action}`, performedBy: session.uid, performedByName: session.email, targetId: month,
      details: { month, remarks: remarks || undefined, paidOn: paidOn || undefined, reference: reference || undefined, net: run.totals.net },
    });
    const notice = action === "SUBMIT" ? "SUBMITTED" : action === "RETURN" ? "RETURNED" : action === "APPROVE" ? "APPROVED" : action === "RELEASE" ? "RELEASED" : null;
    if (notice) await notifyPayroll(db, session.collegeId, month, notice, lines);
    return NextResponse.json({ status: action === "RELEASE" ? "RELEASED" : run.status });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/runs/[month] POST]");
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollActor(db, request);
    if (session.actor !== "OFFICE" && !session.superAdmin) throw new PayrollError("The College Office removes a draft", 403);
    const month = await monthOf(params);
    const refs = runRefs(db, session.collegeId, month);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(refs.run);
      if (!snap.exists) throw new PayrollError("Not found", 404);
      if ((snap.data() as PayrollRun).status !== "DRAFT") throw new PayrollError("Only a draft that was never submitted can be removed", 409);
      tx.delete(refs.run);
    });
    const batch = new ChunkedBatch(db);
    for (const d of (await refs.lines.get()).docs) batch.delete(d.ref);
    await batch.commit();
    await writeAuditLogSafe(db, session.collegeId, { action: "PAYROLL_RUN_DELETED", performedBy: session.uid, performedByName: session.email, targetId: month, details: { month } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/runs/[month] DELETE]");
  }
}
