export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { hasReceipt, PaymentError, paymentErrorResponse, paymentOf, paymentRefs, paymentView, receiptCollege, requirePaymentsManager } from "@/lib/payments/server";

// Accounts / Super Admin: a payment's fee receipt data (?collegeId) for printing / reprinting.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const db = getAdminDb();
    const session = await requirePaymentsManager(db, request);
    const { id } = await params;
    const snap = await paymentRefs(db, session.collegeId).payments.doc(id).get();
    if (!snap.exists) throw new PaymentError("Payment not found", 404);
    const p = paymentOf(snap.id, snap.data());
    if (!hasReceipt(p)) throw new PaymentError("A receipt is given once the payment succeeds", 409);
    return NextResponse.json({ payment: paymentView(p), college: await receiptCollege(db, session.collegeId) });
  } catch (err) {
    return paymentErrorResponse(err, "[college/payments/[id]/receipt GET]");
  }
}
