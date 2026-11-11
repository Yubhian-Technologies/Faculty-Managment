export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { isMonthKey, revisionFor } from "@/lib/payroll/rules";
import { planPayImport, withRevision, type ImportRow } from "@/lib/payroll/pay";
import { PayrollError, listPayEmployees, loadPayrollSettings, payrollErrorResponse, payrollRefs, releasedOnOrAfter, requirePayrollAccounts } from "@/lib/payroll/server";
import type { EmployeePay, PayRevision } from "@/types/payroll";

// Accounts upload their salary sheet (read in the browser): Emp Code + one column per pay part + Y/N per
// deduction. "preview" writes nothing; "apply" saves only when the whole file is clean, as a revision
// effective from the chosen month for every NEW / CHANGED person (same pay = left alone).

const MAX_ROWS = 2000;

export async function POST(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollAccounts(db, request);
    const body = (await readJsonBody(request)) as { mode?: unknown; effectiveFrom?: unknown; headers?: unknown; rows?: unknown };
    const mode = body.mode === "apply" ? "apply" : "preview";
    if (!isMonthKey(body.effectiveFrom)) throw new PayrollError("Pick the month this pay starts from");
    const effectiveFrom = body.effectiveFrom;
    if (!Array.isArray(body.headers) || !Array.isArray(body.rows)) throw new PayrollError("The file has no rows");
    if (body.rows.length > MAX_ROWS) throw new PayrollError(`At most ${MAX_ROWS} rows per file`);
    const headers = body.headers.map((h) => String(h ?? "").trim());
    const rows: ImportRow[] = (body.rows as unknown[]).map((r, i) => {
      const o = (r ?? {}) as { row?: unknown; code?: unknown; values?: unknown };
      const values = Object.fromEntries(Object.entries((o.values ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]));
      return { row: Number(o.row) || i + 2, code: String(o.code ?? ""), values };
    });

    const [{ settings }, employees, paySnap] = await Promise.all([
      loadPayrollSettings(db, session.collegeId), listPayEmployees(db, session.collegeId), payrollRefs(db, session.collegeId).pay.get(),
    ]);
    const pays = new Map(paySnap.docs.map((d) => [d.id, d.data() as EmployeePay]));
    const current = new Map(employees.map((e) => {
      const r = pays.get(e.employeeKey);
      const rev = r ? revisionFor(r.revisions, effectiveFrom) : null;
      return [e.employeeKey, rev ? { amounts: rev.amounts, exempt: rev.exempt } : null] as const;
    }));
    const plan = planPayImport(headers, rows, employees, settings, current);
    const released = await releasedOnOrAfter(db, session.collegeId, effectiveFrom);
    const blocked = released ? `${released} is already released - pick a later month` : null;
    if (mode === "preview" || plan.errors > 0 || blocked) {
      return NextResponse.json({ ...plan, blocked, applied: 0 }, { status: mode === "apply" && (plan.errors > 0 || blocked) ? 400 : 200 });
    }

    const at = new Date().toISOString();
    const byKey = new Map(employees.map((e) => [e.employeeKey, e]));
    const batch = new ChunkedBatch(db);
    let applied = 0;
    for (const r of plan.rows) {
      if (r.status !== "NEW" && r.status !== "CHANGED") continue;
      const e = byKey.get(r.employeeKey!)!;
      const rev: PayRevision = { effectiveFrom, amounts: r.amounts!, exempt: r.exempt!, note: "Imported from salary sheet", byName: session.email, byUid: session.uid, at };
      const prev = pays.get(e.employeeKey);
      batch.set(payrollRefs(db, session.collegeId).pay.doc(e.employeeKey), {
        employeeKey: e.employeeKey, kind: e.kind, recordId: e.recordId, employeeCode: e.employeeCode, name: e.name,
        revisions: withRevision(prev?.revisions ?? [], rev), updatedAt: at, updatedByName: session.email,
      } satisfies EmployeePay);
      applied++;
    }
    await batch.commit();
    await writeAuditLogSafe(db, session.collegeId, {
      action: "PAYROLL_PAY_IMPORTED", performedBy: session.uid, performedByName: session.email, targetId: effectiveFrom,
      details: { effectiveFrom, applied, rows: plan.rows.length },
    });
    return NextResponse.json({ ...plan, blocked: null, applied });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/pay/import POST]");
  }
}
