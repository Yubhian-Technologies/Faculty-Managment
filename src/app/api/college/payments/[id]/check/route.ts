export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { checkPaymentStatus } from "@/lib/payments/statusCheck";
import { paymentErrorResponse, paymentView, requirePaymentsManager } from "@/lib/payments/server";

// Accounts / Super Admin: ask CCAvenue what happened to one payment (?collegeId) - Order Status API
// through the static-IP proxy - and record it.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const db = getAdminDb();
    const session = await requirePaymentsManager(db, request);
    const { id } = await params;
    const r = await checkPaymentStatus(db, session.collegeId, id, { uid: session.uid, name: session.email });
    return NextResponse.json({ payment: paymentView(r.payment), changed: r.changed });
  } catch (err) {
    return paymentErrorResponse(err, "[college/payments/[id]/check POST]");
  }
}
