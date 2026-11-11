export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { advanceBalance, advanceView, cleanAdvance } from "@/lib/payroll/advance";
import { PayrollRuleError } from "@/lib/payroll/rules";
import { PayrollError, payrollErrorResponse, payrollRefs, requirePayrollAccounts } from "@/lib/payroll/server";
import type { SalaryAdvance } from "@/types/payroll";

// Accounts change an advance: { rev, action, ... }
//  EDIT   - monthly recovery (instalment | recoveryPercent), note; the amount, already-recovered and first
//           month only while nothing has been recovered in the app. Applies to months not yet released
//           (an open month picks it up on Recalculate).
//  PAUSE / RESUME - stop / restart recovery (a paused advance is skipped by new months).
//  CLOSE  - close early with a reason (e.g. paid back in cash). Nothing is ever deleted.

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollAccounts(db, request);
    const { id } = await params;
    if (!/^[A-Za-z0-9]{1,64}$/.test(id)) throw new PayrollError("Not found", 404);
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const ref = payrollRefs(db, session.collegeId).college.collection("salaryAdvances").doc(id);
    const at = new Date().toISOString();
    const saved = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new PayrollError("Not found", 404);
      const a = { ...(snap.data() as SalaryAdvance), id };
      if (Number(body.rev ?? -1) !== a.rev) throw new PayrollError("This advance changed since you opened it - reload and try again", 409);
      if (a.status === "CLOSED") throw new PayrollError("This advance is closed", 409);
      let patch: Partial<SalaryAdvance> = {};
      let change = "";
      switch (body.action) {
        case "PAUSE": if (a.status !== "ACTIVE") throw new PayrollRuleError("Not running"); patch = { status: "PAUSED" }; change = "Recovery paused"; break;
        case "RESUME": if (a.status !== "PAUSED") throw new PayrollRuleError("Not paused"); patch = { status: "ACTIVE" }; change = "Recovery resumed"; break;
        case "CLOSE": {
          const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
          if (!reason) throw new PayrollRuleError("Give a reason for closing it");
          patch = { status: "CLOSED", closedNote: reason };
          change = `Closed with Rs. ${advanceBalance(a)} unrecovered: ${reason}`;
          break;
        }
        case "EDIT": {
          const started = Object.keys(a.recoveries ?? {}).length > 0;
          const input = cleanAdvance({
            amount: started ? a.amount : body.amount ?? a.amount,
            recoveredBefore: started ? a.recoveredBefore : body.recoveredBefore ?? a.recoveredBefore,
            startMonth: started ? a.startMonth : body.startMonth ?? a.startMonth,
            instalment: body.instalment ?? (body.recoveryPercent === undefined ? a.instalment : undefined), recoveryPercent: body.recoveryPercent, givenOn: body.givenOn ?? a.givenOn, note: body.note ?? a.note,
          });
          if (started && advanceBalance(a) <= 0) throw new PayrollRuleError("Nothing left to recover");
          patch = input;
          const moved = (["amount", "recoveredBefore", "instalment", "startMonth"] as const).filter((k) => input[k] !== a[k]).map((k) => `${k} ${a[k]} -> ${input[k]}`);
          change = moved.length ? `Changed: ${moved.join(", ")}` : "Note updated";
          break;
        }
        default: throw new PayrollRuleError("Unknown action");
      }
      const next: SalaryAdvance = { ...a, ...patch, rev: a.rev + 1, history: [...(a.history ?? []), { at, byName: session.email, change }].slice(-100) };
      const { id: _id, ...doc } = next;
      void _id;
      tx.set(ref, doc);
      return { next, change };
    });
    await writeAuditLogSafe(db, session.collegeId, {
      action: `PAYROLL_ADVANCE_${String(body.action)}`, performedBy: session.uid, performedByName: session.email, targetId: id,
      details: { employeeKey: saved.next.employeeKey, change: saved.change },
    });
    return NextResponse.json({ advance: advanceView(saved.next) });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/advances/[id] PATCH]");
  }
}
