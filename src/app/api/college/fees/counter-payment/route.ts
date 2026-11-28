export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { appBaseUrl, paymentErrorResponse } from "@/lib/payments/server";
import { requireFeesCollector } from "@/lib/fees/http";
import { FeeError } from "@/lib/fees/server";
import { cancelCounterPayment, counterStatus, startCounterPayment } from "@/lib/fees/counterPay";

// Fees > Collect > Pay Online through CCAvenue (?collegeId; Accounts, or the College Office for its own college).
// POST { action: "start", accountId, amount } -> { orderId, payUrl, expiresAt }: the QR the student scans.
// POST { action: "cancel", orderId }: the QR link stops working (a payment already made still settles).
// GET ?orderId= -> where it stands (READY / PAID + its receipt / FAILED / EXPIRED / CANCELLED), polled by the screen.
export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireFeesCollector(db, request);
    const orderId = new URL(request.url).searchParams.get("orderId") ?? "";
    if (!orderId) throw new FeeError("Payment not found. It may have been deleted.", 404);
    return NextResponse.json(await counterStatus(db, session.collegeId, orderId));
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/counter-payment GET]");
  }
}

export async function POST(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireFeesCollector(db, request);
    const body = (await readJsonBody(request)) as { action?: unknown; accountId?: unknown; amount?: unknown; orderId?: unknown };
    if (body.action === "cancel") {
      await cancelCounterPayment(db, session.collegeId, String(body.orderId ?? ""));
      return NextResponse.json({ ok: true });
    }
    if (body.action !== "start") throw new FeeError("Unknown action.");
    const accountId = String(body.accountId ?? "");
    if (!accountId) throw new FeeError("Fee not found. It may have been deleted.", 404);
    const out = await startCounterPayment(db, session.collegeId, { accountId, amount: Number(body.amount), base: appBaseUrl(request), byUid: session.uid, byName: session.byName });
    return NextResponse.json(out);
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/counter-payment POST]");
  }
}
