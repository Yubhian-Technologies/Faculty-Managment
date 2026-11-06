export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { checkPaymentStatus } from "@/lib/payments/statusCheck";
import { PaymentError, paymentErrorResponse, paymentOf, paymentRefs, paymentView } from "@/lib/payments/server";

// A student asks again about their OWN unfinished payment ("I paid but it says not completed").
// At most once a minute per payment.
type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember("STUDENT");
    const db = getAdminDb();
    const { id } = await params;
    const snap = await paymentRefs(db, session.collegeId).payments.doc(id).get();
    const p = snap.exists ? paymentOf(snap.id, snap.data()) : null;
    if (!p || p.studentUid !== session.uid) throw new PaymentError("Payment not found", 404);
    if (p.lastCheckedAt && Date.now() - new Date(p.lastCheckedAt).getTime() < 60_000) throw new PaymentError("Checked a moment ago - try again in a minute", 409);
    const r = await checkPaymentStatus(db, session.collegeId, id, { uid: session.uid, name: p.studentName });
    return NextResponse.json({ payment: paymentView(r.payment), changed: r.changed });
  } catch (err) {
    return paymentErrorResponse(err, "[college/payments/my/[id]/check POST]");
  }
}
