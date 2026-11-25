export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { paymentErrorResponse } from "@/lib/payments/server";
import { requireFeesManager } from "@/lib/fees/http";
import { FeeError, feeRefs, loadBankAccounts, maskAccountNo } from "@/lib/fees/server";
import type { FeeBankAccount } from "@/types/fees";

// Accounts > Fees > Setup > Bank Accounts (?collegeId): the college's accounts fees are credited to (each fee head
// names one). GET: the accounts (full numbers - Accounts only). POST { id?, name, bank, accountNo, ifsc, active? }.
// Never deleted - turned off.

export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireFeesManager(db, request);
    return NextResponse.json({ accounts: await loadBankAccounts(db, session.collegeId) });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/bank-accounts GET]");
  }
}

export async function POST(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireFeesManager(db, request);
    const body = (await readJsonBody(request)) as { id?: unknown; name?: unknown; bank?: unknown; accountNo?: unknown; ifsc?: unknown; active?: unknown };
    const name = String(body.name ?? "").trim().replace(/\s+/g, " ");
    const bank = String(body.bank ?? "").trim().replace(/\s+/g, " ");
    const accountNo = String(body.accountNo ?? "").replace(/\s+/g, "");
    const ifsc = String(body.ifsc ?? "").trim().toUpperCase();
    if (!name || name.length > 60) throw new FeeError("Enter a name for the account (for example College Fee Account).");
    if (!bank || bank.length > 80) throw new FeeError("Enter the bank name.");
    if (!/^\d{6,20}$/.test(accountNo)) throw new FeeError("Enter the account number (6 to 20 digits).");
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new FeeError("Enter a valid IFSC (for example SBIN0001234).");
    const all = await loadBankAccounts(db, session.collegeId);
    const id = typeof body.id === "string" && body.id ? body.id : null;
    const cur = all.find((a) => a.id === id);
    if (id && !cur) throw new FeeError("Bank account not found. It may have been deleted.", 404);
    if (all.some((a) => a.id !== id && (a.accountNo === accountNo || a.name.toLowerCase() === name.toLowerCase()))) throw new FeeError("Another account already has that name or number.", 409);
    const ref = id ? feeRefs(db, session.collegeId).bankAccounts.doc(id) : feeRefs(db, session.collegeId).bankAccounts.doc();
    const acct: FeeBankAccount = { id: ref.id, name, bank, accountNo, ifsc, active: body.active === undefined ? cur?.active ?? true : body.active === true, updatedAt: new Date().toISOString(), updatedByName: session.byName };
    await ref.set(acct);
    await writeAuditLogSafe(db, session.collegeId, { action: id ? "FEE_BANK_ACCOUNT_UPDATED" : "FEE_BANK_ACCOUNT_ADDED", performedBy: session.uid, performedByName: session.byName, targetId: ref.id, details: { name, bank, accountNo: maskAccountNo(accountNo), ifsc, active: acct.active } });
    return NextResponse.json({ account: acct });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/bank-accounts POST]");
  }
}
