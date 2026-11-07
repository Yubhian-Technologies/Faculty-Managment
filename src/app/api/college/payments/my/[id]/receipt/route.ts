export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { hasReceipt, PaymentError, paymentErrorResponse, paymentOf, paymentRefs, paymentView, receiptCollege } from "@/lib/payments/server";

// The student's own fee receipt data (the payment + the college letterhead) for printing.
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember("STUDENT");
    const db = getAdminDb();
    const { id } = await params;
    const snap = await paymentRefs(db, session.collegeId).payments.doc(id).get();
    const p = snap.exists ? paymentOf(snap.id, snap.data()) : null;
    if (!p || p.studentUid !== session.uid) throw new PaymentError("Payment not found", 404);
    if (!hasReceipt(p)) throw new PaymentError("A receipt is given once the payment succeeds", 409);
    return NextResponse.json({ payment: paymentView(p), college: await receiptCollege(db, session.collegeId) });
  } catch (err) {
    return paymentErrorResponse(err, "[college/payments/my/[id]/receipt GET]");
  }
}
