export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { notify } from "@/lib/notify";
import { CERTIFICATE_REQUESTS_COL } from "@/lib/certifications/transitions";
import { refundOrder } from "@/lib/payments/ccavenueApi";
import { paymentProxyConfigured } from "@/lib/payments/proxyPost";
import { activeCcavenue, PaymentError, paymentErrorResponse, paymentOf, paymentRefs, paymentView, requirePaymentsManager } from "@/lib/payments/server";
import type { CertificateRequest, Payment, PaymentRefund } from "@/types";

// Accounts / Super Admin refund a successful payment (?collegeId):
//   { via: "CCAVENUE", amount, reason }               refunded now through CCAvenue's Refund API (static-IP proxy)
//   { via: "RECORDED", amount, reference, reason }    refunded in the CCAvenue dashboard, recorded here
// Never more than was paid. A full refund marks the payment REFUNDED and, while the certificate isn't
// issued yet, takes the fee off the request (the student pays again, or at the office). The student is told.

type Params = { params: Promise<{ id: string }> };
const round = (n: number) => Math.round(n * 100) / 100;

function check(p: Payment, amount: number) {
  if (p.status !== "SUCCESS" && p.status !== "PARTIALLY_REFUNDED") throw new PaymentError("Only a successful payment can be refunded", 409);
  const left = round(p.amount - (p.refundedAmount ?? 0));
  if (amount > left) throw new PaymentError(`At most Rs. ${left} can still be refunded`, 409);
}

/** Adds the refund to the payment (and takes the fee off the request on a full refund), in one transaction. */
async function recordRefund(db: Firestore, collegeId: string, id: string, refund: PaymentRefund): Promise<Payment> {
  const ref = paymentRefs(db, collegeId).payments.doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new PaymentError("Payment not found", 404);
    const p = paymentOf(snap.id, snap.data());
    check(p, refund.amount);
    const reqRef = p.purpose.kind === "CERTIFICATE" ? CERTIFICATE_REQUESTS_COL(db, collegeId).doc(p.purpose.requestId) : null;
    const reqSnap = reqRef ? await tx.get(reqRef) : null;
    const refundedAmount = round((p.refundedAmount ?? 0) + refund.amount);
    const full = refundedAmount >= p.amount;
    const next: Partial<Payment> = {
      refunds: [...(p.refunds ?? []), refund], refundedAmount, status: full ? "REFUNDED" : "PARTIALLY_REFUNDED",
      refundPending: null, updatedAt: refund.at, ...(full ? { needsRefund: false } : {}),
    };
    tx.update(ref, next);
    if (full && reqRef && reqSnap?.exists) {
      const req = reqSnap.data() as CertificateRequest;
      if (req.feePaid?.paymentId === p.id && req.status !== "ISSUED") tx.update(reqRef, { feePaid: FieldValue.delete(), updatedAt: new Date() });
    }
    return { ...p, ...next } as Payment;
  });
}

export async function POST(request: Request, { params }: Params) {
  try {
    const db = getAdminDb();
    const session = await requirePaymentsManager(db, request);
    const { id } = await params;
    const body = (await readJsonBody(request)) as { via?: unknown; amount?: unknown; reference?: unknown; reason?: unknown };
    const via = body.via === "CCAVENUE" ? "CCAVENUE" : "RECORDED";
    const amount = round(Number(body.amount));
    const reason = String(body.reason ?? "").trim().slice(0, 300);
    let reference = String(body.reference ?? "").trim().slice(0, 80);
    if (!(amount > 0)) throw new PaymentError("Enter the amount to refund");
    if (!reason) throw new PaymentError("Enter the reason for the refund");
    if (via === "RECORDED" && !reference) throw new PaymentError("Enter CCAvenue's refund reference");
    const byName = session.email;
    const ref = paymentRefs(db, session.collegeId).payments.doc(id);

    if (via === "CCAVENUE") {
      if (!paymentProxyConfigured()) throw new PaymentError("Refunds through CCAvenue need the static IP proxy - refund in the CCAvenue dashboard and record it", 409);
      const account = await activeCcavenue(db, session.collegeId);
      if (!account) throw new PaymentError("Online payment is off for this college", 409);
      // Claim the refund first, so a double click can't refund twice. Our refund reference is fixed
      // per refund number, so a retry after a lost answer reuses it (CCAvenue refuses a repeated one).
      const claimed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new PaymentError("Payment not found", 404);
        const p = paymentOf(snap.id, snap.data());
        check(p, amount);
        if (!p.trackingId) throw new PaymentError("This payment has no CCAvenue reference", 409);
        if (p.refundPending && Date.now() - new Date(p.refundPending.at).getTime() < 5 * 60_000) throw new PaymentError("A refund of this payment is already being made - wait a moment and reload", 409);
        const refundRef = `R${p.id}${(p.refunds?.length ?? 0) + 1}`.slice(0, 30);
        tx.update(ref, { refundPending: { ref: refundRef, amount, at: new Date().toISOString(), byName } });
        return { trackingId: p.trackingId, refundRef };
      });
      let answer: { ok: boolean; reason: string };
      try { answer = await refundOrder(account, claimed.trackingId, amount, claimed.refundRef); }
      catch (e) {
        // Unknown whether CCAvenue did it: keep the claim (5 minutes) and say so - check their dashboard first.
        console.error("[college/payments/[id]/refund CCAvenue]", e);
        throw new PaymentError("CCAvenue didn't answer - check the order in their dashboard before trying again", 503);
      }
      if (!answer.ok) {
        await ref.update({ refundPending: null });
        throw new PaymentError(`CCAvenue refused the refund: ${answer.reason || "no reason given"}`, 409);
      }
      reference = claimed.refundRef;
    }

    const updated = await recordRefund(db, session.collegeId, id, {
      at: new Date().toISOString(), amount, reference, reason, byUid: session.uid, byName, via: via === "CCAVENUE" ? "CCAVENUE_API" : "RECORDED",
    });
    await writeAuditLogSafe(db, session.collegeId, {
      action: "PAYMENT_REFUNDED", performedBy: session.uid, performedByName: byName, targetId: id,
      details: { via, amount, reference, reason, student: updated.studentName, purpose: updated.purpose.label },
    });
    if (updated.studentUid) {
      await notify(db, session.collegeId, updated.studentUid, "PAYMENT_REFUNDED", "Payment refunded",
        `Rs. ${amount} of your payment for ${updated.purpose.label} was refunded (ref ${reference}). It reaches your account in a few working days.`, `/student/payments/${encodeURIComponent(id)}`);
    }
    return NextResponse.json({ payment: paymentView(updated) });
  } catch (err) {
    return paymentErrorResponse(err, "[college/payments/[id]/refund POST]");
  }
}
