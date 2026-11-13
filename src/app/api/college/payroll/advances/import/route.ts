export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { planAdvanceImport, type AdvanceImportRow } from "@/lib/payroll/advance";
import { PayrollError, listPayEmployees, payrollErrorResponse, payrollRefs, releasedOnOrAfter, requirePayrollAccounts } from "@/lib/payroll/server";
import type { SalaryAdvance } from "@/types/payroll";

// Accounts load the advances already running when payroll starts in the app (read in the browser):
// Emp Code, Advance amount, Recovered so far, Monthly recovery (or Monthly %), First month, Note.
// "preview" writes nothing; "apply" adds every row only when the whole file is clean.

export async function POST(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollAccounts(db, request);
    const body = (await readJsonBody(request)) as { mode?: unknown; headers?: unknown; rows?: unknown };
    if (!Array.isArray(body.headers) || !Array.isArray(body.rows)) throw new PayrollError("The file has no rows");
    if (body.rows.length > 1000) throw new PayrollError("At most 1000 rows per file");
    const headers = body.headers.map((h) => String(h ?? "").trim());
    const rows: AdvanceImportRow[] = (body.rows as unknown[]).map((r, i) => {
      const o = (r ?? {}) as { row?: unknown; code?: unknown; values?: unknown };
      return { row: Number(o.row) || i + 2, code: String(o.code ?? ""), values: Object.fromEntries(Object.entries((o.values ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")])) };
    });
    const employees = await listPayEmployees(db, session.collegeId);
    const plan = planAdvanceImport(headers, rows, employees);
    for (const r of plan.rows) {
      if (r.status !== "OK") continue;
      const released = await releasedOnOrAfter(db, session.collegeId, r.advance!.startMonth);
      if (!released) continue;
      Object.assign(r, { status: "ERROR", error: `${released} is already released - start recovery from a later month` });
      plan.errors++;
    }
    if (body.mode !== "apply" || plan.errors > 0) return NextResponse.json({ ...plan, applied: 0 }, { status: body.mode === "apply" && plan.errors > 0 ? 400 : 200 });

    const at = new Date().toISOString();
    const col = payrollRefs(db, session.collegeId).college.collection("salaryAdvances");
    const byKey = new Map(employees.map((e) => [e.employeeKey, e]));
    const batch = new ChunkedBatch(db);
    for (const r of plan.rows) {
      const e = byKey.get(r.employeeKey!)!;
      const a = r.advance!;
      batch.set(col.doc(), {
        employeeKey: e.employeeKey, employeeCode: e.employeeCode, name: e.name, ...a, status: "ACTIVE", recoveries: {}, rev: 1,
        createdAt: at, createdByName: session.email,
        history: [{ at, byName: session.email, change: `Imported: advance ₹${a.amount}, ₹${a.recoveredBefore} recovered before, ₹${a.instalment} a month from ${a.startMonth}` }],
      } satisfies Omit<SalaryAdvance, "id">);
    }
    await batch.commit();
    await writeAuditLogSafe(db, session.collegeId, { action: "PAYROLL_ADVANCES_IMPORTED", performedBy: session.uid, performedByName: session.email, details: { count: plan.rows.length } });
    return NextResponse.json({ ...plan, applied: plan.rows.length });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/advances/import POST]");
  }
}
