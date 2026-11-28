export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { appBaseUrl } from "@/lib/payments/server";
import { counterCheckout } from "@/lib/fees/counterPay";

// The page a student's phone opens from the fee counter's QR (/pay/<college>/<order>?k=<token>). Public on purpose
// - the student need not sign in - and read only: without the payment's own random token it answers 404, and it
// shows only that one payment (amount, student, status) plus, while it can be paid, CCAvenue's checkout form.
type Params = { params: Promise<{ collegeId: string; orderId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { collegeId, orderId } = await params;
    const k = new URL(request.url).searchParams.get("k");
    const out = await counterCheckout(getAdminDb(), collegeId, orderId, k, appBaseUrl(request));
    if (!out) return NextResponse.json({ error: "This payment link is not valid. Ask the fee counter for a new QR." }, { status: 404 });
    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[public/fee-pay GET]", err);
    return NextResponse.json({ error: "Unable to open this payment. Try again; if it continues, ask at the fee counter." }, { status: 500 });
  }
}
