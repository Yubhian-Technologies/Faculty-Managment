export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { paymentErrorResponse } from "@/lib/payments/server";
import { requireFeesManager } from "@/lib/fees/http";
import { FeeError } from "@/lib/fees/server";
import { ACADEMIC_YEAR_RE } from "@/lib/fees/rules";
import { importDebitNotes, MAX_IMPORT_ROWS } from "@/lib/fees/importServer";
import type { DebitNoteRow } from "@/lib/fees/importPrevious";

// Accounts > Fees > Import Previous Fees > Debit Notes (?collegeId): POST { academicYear, rows, apply } - each
// student's fee for the year exactly as the previous system charged it (lib/fees/importPrevious.ts). apply false =
// check only; apply saves only when no row has a problem. A fee that already has payments is never replaced.
const KEYS = ["roll", "admissionType", "category", "payment", "total", "tuition", "scholarship", "feeType", "voucherNo", "voucherDate"] as const;

export async function POST(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireFeesManager(db, request);
    const body = (await readJsonBody(request)) as { academicYear?: unknown; rows?: unknown; apply?: unknown };
    const academicYear = String(body.academicYear ?? "");
    if (!ACADEMIC_YEAR_RE.test(academicYear)) throw new FeeError("Select the academic year.");
    if (!Array.isArray(body.rows) || body.rows.length === 0) throw new FeeError("The file has no rows.");
    if (body.rows.length > MAX_IMPORT_ROWS) throw new FeeError(`At most ${MAX_IMPORT_ROWS} rows per file.`);
    const rows: DebitNoteRow[] = body.rows.map((x, i) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return { row: Number(o.row) || i + 2, ...Object.fromEntries(KEYS.map((k) => [k, String(o[k] ?? "").trim().slice(0, 120)])) } as DebitNoteRow;
    });
    const apply = body.apply === true;
    const out = await importDebitNotes(db, session.collegeId, { academicYear, rows, apply, byName: session.byName });
    if (apply) {
      const count = (o: string) => out.rows.filter((r) => r.outcome === o).length;
      await writeAuditLogSafe(db, session.collegeId, { action: "FEES_IMPORTED", performedBy: session.uid, performedByName: session.byName, targetId: academicYear, details: { academicYear, rows: rows.length, NEW: count("NEW"), UPDATED: count("UPDATED"), KEPT: count("KEPT") } });
    }
    return NextResponse.json(out);
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/import/debit-notes POST]");
  }
}
