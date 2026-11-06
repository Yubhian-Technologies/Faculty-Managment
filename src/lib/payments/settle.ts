import type { Firestore } from "firebase-admin/firestore";
import { CERTIFICATE_REQUESTS_COL } from "@/lib/certifications/transitions";
import { sameAmount, type CcavResponse } from "./ccavenue";
import { paymentOf, paymentRefs } from "./server";
import type { CertificateRequest, Payment, PaymentStatus } from "@/types";

// Records CCAvenue's answer on a payment - once. The same answer arriving twice (the redirect and a
// later status check, a browser refresh) changes nothing. A SUCCESS marks what was paid for as paid
// (the certificate request's `feePaid`) in the same transaction.

export type Settlement =
  | { kind: "IGNORE"; reason: string }
  | { kind: "SET"; status: PaymentStatus; note?: string };

/**
 * What a response does to a payment (pure). Only an INITIATED / FAILED / ABORTED payment can change;
 * a SUCCESS needs the same order, amount and currency we asked for - otherwise it is recorded as
 * FAILED with the reason, for Accounts to look at.
 */
export function decideSettlement(p: Pick<Payment, "id" | "status" | "amount" | "collegeId">, r: CcavResponse): Settlement {
  if (r.orderId !== p.id) return { kind: "IGNORE", reason: "Different order" };
  if (p.status === "SUCCESS" || p.status === "REFUNDED" || p.status === "PARTIALLY_REFUNDED") return { kind: "IGNORE", reason: "Already settled" };
  if (r.outcome !== "SUCCESS") {
    // A failed / aborted answer never overwrites one already recorded the same way.
    return p.status === r.outcome ? { kind: "IGNORE", reason: "Already recorded" } : { kind: "SET", status: r.outcome };
  }
  if (r.merchantParam1 && r.merchantParam1 !== p.collegeId) return { kind: "SET", status: "FAILED", note: "The payment answer was for another college" };
  if (!sameAmount(r.amount, p.amount)) return { kind: "SET", status: "FAILED", note: `Amount mismatch: asked Rs. ${p.amount}, CCAvenue reported Rs. ${r.fields.amount ?? "?"}` };
  if (r.currency && r.currency !== "INR") return { kind: "SET", status: "FAILED", note: `Currency mismatch: ${r.currency}` };
  return { kind: "SET", status: "SUCCESS" };
}

export interface SettleResult { payment: Payment; changed: boolean; newlyPaid: boolean; alreadyPaidByOther: boolean }

export async function settlePayment(db: Firestore, collegeId: string, r: CcavResponse): Promise<SettleResult | null> {
  const ref = paymentRefs(db, collegeId).payments.doc(r.orderId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const p = paymentOf(snap.id, snap.data());
    const decision = decideSettlement(p, r);
    if (decision.kind === "IGNORE") return { payment: p, changed: false, newlyPaid: false, alreadyPaidByOther: false };

    // Reads first (Firestore transactions): what was paid for.
    const reqRef = p.purpose.kind === "CERTIFICATE" ? CERTIFICATE_REQUESTS_COL(db, collegeId).doc(p.purpose.requestId) : null;
    const reqSnap = reqRef && decision.status === "SUCCESS" ? await tx.get(reqRef) : null;

    const now = new Date().toISOString();
    const next: Payment = {
      ...p,
      status: decision.status,
      trackingId: r.trackingId || p.trackingId, bankRefNo: r.bankRefNo || p.bankRefNo,
      paymentMode: r.paymentMode || p.paymentMode, cardName: r.cardName || p.cardName,
      gatewayStatus: r.orderStatus, statusMessage: r.statusMessage, failureMessage: decision.note ?? r.failureMessage,
      gatewayResponse: r.fields, settledAt: now, updatedAt: now,
    };
    let alreadyPaidByOther = false;
    if (decision.status === "SUCCESS" && reqRef && reqSnap?.exists) {
      const req = reqSnap.data() as CertificateRequest;
      if (req.feePaid && req.feePaid.paymentId !== p.id) {
        // Paid twice (two tabs): this one is kept as SUCCESS and flagged for a refund.
        alreadyPaidByOther = true;
        next.needsRefund = true;
        next.failureMessage = `Paid twice - the fee was already paid by order ${req.feePaid.paymentId}. Refund this one.`;
      } else {
        tx.update(reqRef, { feePaid: { paymentId: p.id, trackingId: next.trackingId ?? "", bankRefNo: next.bankRefNo ?? "", amount: p.amount, at: now }, updatedAt: new Date() });
      }
    }
    const { id: _id, ...data } = next;
    void _id;
    tx.set(ref, data);
    return { payment: next, changed: true, newlyPaid: decision.status === "SUCCESS" && !alreadyPaidByOther, alreadyPaidByOther };
  });
}
