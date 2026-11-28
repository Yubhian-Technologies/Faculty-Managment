export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { paymentErrorResponse, receiptCollege } from "@/lib/payments/server";
import { requireFeesCollector } from "@/lib/fees/http";
import { activeCcavenue } from "@/lib/payments/server";
import { FeeError, feeRefs } from "@/lib/fees/server";
import { instalmentStates } from "@/lib/fees/rules";
import type { FeeReceipt, StudentFeeAccount } from "@/types/fees";

// Accounts > Fees > a student's fee account (?collegeId): the account, its instalments as of today (paid / due /
// overdue / fine) and every receipt (cancelled ones included).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const db = getAdminDb();
    const session = await requireFeesCollector(db, request);
    const { id } = await params;
    const refs = feeRefs(db, session.collegeId);
    const snap = await refs.accounts.doc(id).get();
    if (!snap.exists) throw new FeeError("Fee account not found. It may have been deleted.", 404);
    const account = snap.data() as StudentFeeAccount;
    const [rSnap, college] = await Promise.all([refs.receipts.where("accountId", "==", id).get(), receiptCollege(db, session.collegeId)]);
    const receipts = rSnap.docs.map((d) => d.data() as FeeReceipt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    return NextResponse.json({ account, instalments: instalmentStates(account, today), receipts, college, today, canCancel: session.canCancel, onlinePay: !!(await activeCcavenue(db, session.collegeId).catch(() => null)) });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/accounts/[id] GET]");
  }
}
