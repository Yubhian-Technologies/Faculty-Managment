import type { Firestore } from "firebase-admin/firestore";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { notify } from "@/lib/notify";
import { orderStatus } from "./ccavenueApi";
import { paymentProxyConfigured } from "./proxyPost";
import { activeCcavenue, PaymentError, paymentOf, paymentRefs } from "./server";
import { settlePayment } from "./settle";
import type { Payment } from "@/types";

// Asks CCAvenue (Order Status API, through the static-IP proxy) what happened to one payment and
// records it with the same `settlePayment` the redirect uses - so a student who closed the browser
// before coming back still gets their fee marked paid. Repeating it changes nothing.

/** Payments worth asking about: not paid yet (INITIATED, or FAILED / ABORTED that may have gone through). */
export const checkable = (p: Pick<Payment, "status">) => p.status === "INITIATED" || p.status === "FAILED" || p.status === "ABORTED";

export async function checkPaymentStatus(db: Firestore, collegeId: string, paymentId: string, by: { uid: string; name: string }): Promise<{ payment: Payment; changed: boolean }> {
  if (!paymentProxyConfigured()) throw new PaymentError("Status checks need the static IP proxy - check this order in the CCAvenue dashboard", 409);
  const account = await activeCcavenue(db, collegeId);
  if (!account) throw new PaymentError("Online payment is off for this college", 409);
  const ref = paymentRefs(db, collegeId).payments.doc(paymentId);
  const snap = await ref.get();
  if (!snap.exists) throw new PaymentError("Payment not found", 404);
  const before = paymentOf(snap.id, snap.data());
  if (!checkable(before)) return { payment: before, changed: false };

  const answer = await orderStatus(account, paymentId);
  const now = new Date().toISOString();
  if (!answer) {
    await ref.update({ lastCheckedAt: now, statusCheckCount: (before.statusCheckCount ?? 0) + 1 });
    return { payment: { ...before, lastCheckedAt: now }, changed: false };
  }
  const settled = await settlePayment(db, collegeId, answer);
  await ref.update({ lastCheckedAt: now, statusCheckCount: (before.statusCheckCount ?? 0) + 1 });
  if (!settled) return { payment: before, changed: false };
  const p = settled.payment;
  if (settled.changed) {
    await writeAuditLogSafe(db, collegeId, {
      action: `PAYMENT_${p.status}`, performedBy: by.uid, performedByName: by.name, targetId: p.id,
      details: { via: "CCAvenue status check", amount: p.amount, trackingId: p.trackingId ?? "", gatewayStatus: answer.orderStatus },
    });
    if (settled.newlyPaid) {
      await notify(db, collegeId, p.studentUid, "PAYMENT_RECEIVED", "Payment received",
        `Rs. ${p.amount} paid for ${p.purpose.label} (CCAvenue ref ${p.trackingId}).`, `/student/payments/${encodeURIComponent(p.id)}`);
    }
  }
  return { payment: { ...p, lastCheckedAt: now }, changed: settled.changed };
}
