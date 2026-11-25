export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { notify } from "@/lib/notify";
import { paymentErrorResponse } from "@/lib/payments/server";
import { requireFeesManager } from "@/lib/fees/http";
import { FeeError, feeRefs, recordCounterPayment } from "@/lib/fees/server";
import { DATE_RE } from "@/lib/fees/rules";
import type { FeeReceipt } from "@/types/fees";

// Accounts > Fees (?collegeId):
// GET ?from=&to=   the receipt register / day book (by the date paid, YYYY-MM-DD, at most 366 days)
// POST { accountId, rev, amount, mode, reference, bank?, paidOn, remarks? }   a payment taken at the counter: checked
//      against the balance, numbered from the college's fee receipt series, allocated to the instalments oldest first.

export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireFeesManager(db, request);
    const sp = new URL(request.url).searchParams;
    const from = sp.get("from") ?? "", to = sp.get("to") ?? "";
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) throw new FeeError("Select the dates.");
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw new FeeError("Pick at most a year.");
    const receipts = (await feeRefs(db, session.collegeId).receipts.where("paidOn", ">=", from).where("paidOn", "<=", to).get()).docs
      .map((d) => d.data() as FeeReceipt).sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.createdAt.localeCompare(b.createdAt));
    return NextResponse.json({ receipts });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/receipts GET]");
  }
}

export async function POST(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireFeesManager(db, request);
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    if (typeof body.accountId !== "string" || !body.accountId) throw new FeeError("Select the student.");
    const { receipt, account } = await recordCounterPayment(db, session.collegeId, {
      accountId: body.accountId, rev: body.rev, amount: body.amount, mode: body.mode, reference: body.reference, bank: body.bank, paidOn: body.paidOn, remarks: body.remarks, byName: session.byName,
    });
    await writeAuditLogSafe(db, session.collegeId, { action: "FEE_PAYMENT_RECORDED", performedBy: session.uid, performedByName: session.byName, targetId: receipt.id, details: { receiptNo: receipt.receiptNo, rollNumber: receipt.rollNumber, amount: receipt.amount, mode: receipt.mode, reference: receipt.reference } });
    if (account.studentUid) {
      await notify(db, session.collegeId, account.studentUid, "GENERAL", "Fee Payment Received", `Rs. ${receipt.amount} received for ${receipt.academicYear} fees (receipt ${receipt.receiptNo}). Balance: Rs. ${Math.max(0, account.balance)}.`, "/student/fees").catch(() => undefined);
    }
    return NextResponse.json({ receipt, account });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/receipts POST]");
  }
}
