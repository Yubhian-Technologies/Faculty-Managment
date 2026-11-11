export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { emptyTaxProfile } from "@/lib/payroll/tax";
import { planTaxImport, type TaxImportRow } from "@/lib/payroll/taxImport";
import { fyFrom, profileId, taxRefs } from "@/lib/payroll/taxServer";
import { PayrollError, listPayEmployees, payrollErrorResponse, requirePayrollAccounts } from "@/lib/payroll/server";
import type { PayrollTaxProfile } from "@/types/payroll";

// Go-live: Accounts load each person's regime and what was paid / deducted this financial year before
// payroll moved into the app (Emp Code, Regime, Paid up to, Gross, Basic, HRA, TDS, PF, PT). Declarations
// already saved are kept. "preview" writes nothing; "apply" saves only a clean file (one transaction per person).

export async function POST(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollAccounts(db, request);
    const fy = fyFrom(request);
    const body = (await readJsonBody(request)) as { mode?: unknown; headers?: unknown; rows?: unknown };
    if (!Array.isArray(body.headers) || !Array.isArray(body.rows)) throw new PayrollError("The file has no rows");
    if (body.rows.length > 2000) throw new PayrollError("At most 2000 rows per file");
    const rows: TaxImportRow[] = (body.rows as unknown[]).map((r, i) => {
      const o = (r ?? {}) as { row?: unknown; code?: unknown; values?: unknown };
      return { row: Number(o.row) || i + 2, code: String(o.code ?? ""), values: Object.fromEntries(Object.entries((o.values ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")])) };
    });
    const plan = planTaxImport(body.headers.map((h) => String(h ?? "").trim()), rows, await listPayEmployees(db, session.collegeId), fy);
    if (body.mode !== "apply" || plan.errors > 0) return NextResponse.json({ ...plan, applied: 0 }, { status: body.mode === "apply" && plan.errors > 0 ? 400 : 200 });
    const at = new Date().toISOString();
    const col = taxRefs(db, session.collegeId).profiles;
    for (let i = 0; i < plan.rows.length; i += 25) {
      await Promise.all(plan.rows.slice(i, i + 25).map((r) => db.runTransaction(async (tx) => {
        const ref = col.doc(profileId(fy, r.employeeKey!));
        const snap = await tx.get(ref);
        const cur = snap.exists ? (snap.data() as PayrollTaxProfile) : emptyTaxProfile(r.employeeKey!, fy);
        tx.set(ref, {
          ...cur, regime: r.regime!, opening: r.opening!, rev: cur.rev + 1, updatedAt: at, updatedByName: session.email,
          history: [...(cur.history ?? []), { at, byName: session.email, change: `Imported: ${r.regime} regime, paid up to ${r.opening!.upToMonth} (gross ${r.opening!.gross}, TDS ${r.opening!.tds})` }].slice(-50),
        } satisfies PayrollTaxProfile);
      })));
    }
    await writeAuditLogSafe(db, session.collegeId, { action: "PAYROLL_TAX_OPENING_IMPORTED", performedBy: session.uid, performedByName: session.email, targetId: fy, details: { fy, count: plan.rows.length } });
    return NextResponse.json({ ...plan, applied: plan.rows.length });
  } catch (err) {
    if (err instanceof Error && err.message === "BAD_FY") return NextResponse.json({ error: "Financial year must look like 2026-27" }, { status: 400 });
    return payrollErrorResponse(err, "[college/payroll/tax/import POST]");
  }
}
