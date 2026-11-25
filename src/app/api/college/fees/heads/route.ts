export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { paymentErrorResponse } from "@/lib/payments/server";
import { requireFeesManager } from "@/lib/fees/http";
import { FeeError, feeRefs, loadBankAccounts, loadHeads } from "@/lib/fees/server";
import type { FeeHead } from "@/types/fees";

// Accounts > Fees > Fee Heads (?collegeId): Tuition, Special Fee, Development Fee, Lab Fee ...
// GET: the heads. POST { id?, name, code, order?, active?, bankAccountId? }: add or edit one (a head is never
// deleted - turn it off). Each head is credited to one of the college's bank accounts.

export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireFeesManager(db, request);
    return NextResponse.json({ heads: await loadHeads(db, session.collegeId) });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/heads GET]");
  }
}

export async function POST(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireFeesManager(db, request);
    const body = (await readJsonBody(request)) as { id?: unknown; name?: unknown; code?: unknown; order?: unknown; active?: unknown; bankAccountId?: unknown };
    const name = String(body.name ?? "").trim().replace(/\s+/g, " ");
    const code = String(body.code ?? "").trim().toUpperCase();
    if (!name || name.length > 60) throw new FeeError("Enter the fee head name (up to 60 characters).");
    if (!/^[A-Z0-9_-]{1,12}$/.test(code)) throw new FeeError("Enter a short code (up to 12 letters or numbers).");
    const all = await loadHeads(db, session.collegeId);
    const id = typeof body.id === "string" && body.id ? body.id : null;
    if (id && !all.some((h) => h.id === id)) throw new FeeError("Fee head not found. It may have been deleted.", 404);
    const clash = all.find((h) => h.id !== id && (h.code === code || h.name.toLowerCase() === name.toLowerCase()));
    if (clash) throw new FeeError(`${clash.name} (${clash.code}) already has that name or code.`, 409);
    const bankAccountId = typeof body.bankAccountId === "string" && body.bankAccountId ? body.bankAccountId : null;
    if (bankAccountId && !(await loadBankAccounts(db, session.collegeId)).some((b) => b.id === bankAccountId)) throw new FeeError("The bank account is not found. Reload and try again.");
    const at = new Date().toISOString();
    const ref = id ? feeRefs(db, session.collegeId).heads.doc(id) : feeRefs(db, session.collegeId).heads.doc();
    const cur = all.find((h) => h.id === id);
    const head: FeeHead = {
      id: ref.id, name, code, order: Number.isFinite(Number(body.order)) ? Number(body.order) : cur?.order ?? all.length + 1,
      active: body.active === undefined ? cur?.active ?? true : body.active === true,
      bankAccountId: body.bankAccountId === undefined ? cur?.bankAccountId ?? null : bankAccountId, createdAt: cur?.createdAt ?? at, updatedAt: at, updatedByName: session.byName,
    };
    await ref.set(head);
    await writeAuditLogSafe(db, session.collegeId, { action: id ? "FEE_HEAD_UPDATED" : "FEE_HEAD_ADDED", performedBy: session.uid, performedByName: session.byName, targetId: ref.id, details: { name, code, active: head.active, bankAccountId: head.bankAccountId } });
    return NextResponse.json({ head });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/heads POST]");
  }
}
