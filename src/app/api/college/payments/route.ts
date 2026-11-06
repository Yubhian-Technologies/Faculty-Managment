export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { paymentErrorResponse, paymentOf, paymentRefs, paymentView, requirePaymentsManager } from "@/lib/payments/server";
import type { PaymentStatus } from "@/types";

// Accounts / Super Admin: a college's online payments (?collegeId), newest first, optionally
// ?status= and ?from= / ?to= (YYYY-MM-DD, by the day the payment was started, IST).
const STATUSES: PaymentStatus[] = ["INITIATED", "SUCCESS", "FAILED", "ABORTED", "REFUNDED", "PARTIALLY_REFUNDED"];

export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requirePaymentsManager(db, request);
    const q = new URL(request.url).searchParams;
    const status = q.get("status") as PaymentStatus | null;
    let query: FirebaseFirestore.Query = paymentRefs(db, session.collegeId).payments;
    if (status && STATUSES.includes(status)) query = query.where("status", "==", status);
    const from = q.get("from"), to = q.get("to");
    const day = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const payments = (await query.get()).docs
      .map((d) => paymentOf(d.id, d.data()))
      .filter((p) => (!from || day(p.createdAt) >= from) && (!to || day(p.createdAt) <= to))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(paymentView);
    return NextResponse.json({ payments });
  } catch (err) {
    return paymentErrorResponse(err, "[college/payments GET]");
  }
}
