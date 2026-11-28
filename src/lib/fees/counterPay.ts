import { randomBytes, timingSafeEqual } from "crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { Payment } from "@/types/payments";
import type { StudentFeeAccount } from "@/types/fees";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { CCAVENUE_CHECKOUT_URL, ccavEncrypt, ccavRequestString, ccavUrlOk } from "@/lib/payments/ccavenue";
import { activeCcavenue, PaymentError, paymentRefs } from "@/lib/payments/server";
import { onlineReceiptId } from "./online";
import { paymentError } from "./rules";
import { feeRefs } from "./server";

// Fees > Collect > "Pay Online through CCAvenue" (Accounts / College Office at the counter). The counter creates a
// CCAvenue payment for the student's fee, for any amount up to the balance; the screen shows a QR of
// /pay/<college>/<order>?k=<token>. The student opens it on their phone (no sign-in), pays on CCAvenue by UPI, card
// or net banking, and CCAvenue posts back to the college's usual return address - the same settlement as a payment
// from the student's own Fees page makes the receipt (FR- number, split by fee head / bank account). The counter
// screen polls until it is paid. The token is the only key to the page: random, one order, 30 minutes, cancellable.

export const COUNTER_PAY_MINUTES = 30;

export type CounterState = "READY" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED" | "REFUNDED";

/** Where a counter payment stands, as its pay page and the counter screen show it. */
export function counterState(p: Pick<Payment, "status" | "counter">, now: Date = new Date()): CounterState {
  if (p.status === "SUCCESS" || p.status === "PARTIALLY_REFUNDED") return "PAID";
  if (p.status === "REFUNDED") return "REFUNDED";
  if (p.status === "FAILED" || p.status === "ABORTED") return "FAILED";
  if (p.counter?.cancelledAt) return "CANCELLED";
  if (!p.counter || now.toISOString() > p.counter.expiresAt) return "EXPIRED";
  return "READY";
}

/** The pay page's key, compared in constant time. */
export function counterTokenOk(saved: string | undefined, given: string | null | undefined): boolean {
  if (!saved || !given || saved.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(saved), Buffer.from(given));
}

const returnUrl = (base: string, c: string) => `${base}/api/public/ccavenue_response/${encodeURIComponent(c)}`;
export const counterPayUrl = (base: string, c: string, orderId: string, token: string) =>
  `${base}/pay/${encodeURIComponent(c)}/${encodeURIComponent(orderId)}?k=${token}`;

/** Creates the CCAvenue payment for a student's fee at the counter; returns the link the QR carries. */
export async function startCounterPayment(db: Firestore, c: string, q: { accountId: string; amount: number; base: string; byUid: string; byName: string }) {
  const account = await activeCcavenue(db, c);
  if (!account) throw new PaymentError("Online payment isn't on for this college - set up the CCAvenue account on Payments first.", 409);
  if (!ccavUrlOk(returnUrl(q.base, c))) throw new PaymentError("Online payment isn't set up correctly (return address). Open the app from its own address and try again.", 409);
  const fee = (await feeRefs(db, c).accounts.doc(q.accountId).get()).data() as StudentFeeAccount | undefined;
  if (!fee) throw new PaymentError("Fee not found. It may have been deleted.", 404);
  const bad = paymentError(q.amount, fee.balance);
  if (bad) throw new PaymentError(bad, 409);
  const orderId = `FMS${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString("hex").toUpperCase()}`;
  const token = randomBytes(16).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + COUNTER_PAY_MINUTES * 60_000).toISOString();
  const label = `Fees ${fee.academicYear}`;
  const payment: Omit<Payment, "id"> = {
    collegeId: c, purpose: { kind: "FEE", accountId: fee.id, academicYear: fee.academicYear, label },
    amount: q.amount, currency: "INR", status: "INITIATED", gateway: "CCAVENUE",
    studentId: fee.studentId, studentUid: fee.studentUid ?? "", studentName: fee.name, studentRollNumber: fee.rollNumber,
    ...(fee.year ? { studentYear: fee.year } : {}), ...(fee.department ? { studentDepartment: fee.department } : {}), academicYear: fee.academicYear,
    counter: { byUid: q.byUid, byName: q.byName, token, expiresAt, cancelledAt: null },
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
  await paymentRefs(db, c).payments.doc(orderId).create(payment);
  await writeAuditLogSafe(db, c, {
    action: "PAYMENT_STARTED", performedBy: q.byUid, performedByName: q.byName, targetId: orderId,
    details: { amount: q.amount, purpose: label, accountId: fee.id, atCounter: true, student: fee.rollNumber },
  });
  return { orderId, payUrl: counterPayUrl(q.base, c, orderId, token), expiresAt, amount: q.amount };
}

/** A counter payment as the counter screen polls it. */
export async function counterStatus(db: Firestore, c: string, orderId: string) {
  const snap = await paymentRefs(db, c).payments.doc(orderId).get();
  const p = snap.exists ? ({ ...(snap.data() as Omit<Payment, "id">), id: snap.id } as Payment) : null;
  if (!p?.counter) throw new PaymentError("Payment not found. It may have been deleted.", 404);
  const state = counterState(p);
  const receipt = state === "PAID" ? (await feeRefs(db, c).receipts.doc(onlineReceiptId(p.id)).get()).data() : undefined;
  return { orderId: p.id, state, amount: p.amount, paymentMode: p.paymentMode ?? null, trackingId: p.trackingId ?? null, failureMessage: p.failureMessage ?? p.statusMessage ?? null, receipt: receipt ?? null, needsRefund: !!p.needsRefund };
}

/** Stops the QR link working (a payment already made still settles as usual). */
export async function cancelCounterPayment(db: Firestore, c: string, orderId: string) {
  const ref = paymentRefs(db, c).payments.doc(orderId);
  await db.runTransaction(async (tx) => {
    const p = (await tx.get(ref)).data() as Payment | undefined;
    if (!p?.counter) throw new PaymentError("Payment not found. It may have been deleted.", 404);
    if (p.status !== "INITIATED") throw new PaymentError("This payment has already finished.", 409);
    tx.update(ref, { "counter.cancelledAt": new Date().toISOString(), updatedAt: new Date().toISOString() });
  });
}

/** What the student's phone sees on /pay: the payment, and while it can still be paid, the CCAvenue checkout form. */
export async function counterCheckout(db: Firestore, c: string, orderId: string, token: string | null, base: string) {
  const snap = await paymentRefs(db, c).payments.doc(orderId).get();
  const p = snap.exists ? (snap.data() as Payment) : null;
  if (!p?.counter || !counterTokenOk(p.counter.token, token)) return null;
  const state = counterState(p);
  const college = ((await db.collection("colleges").doc(c).get()).data() as { name?: string } | undefined)?.name ?? "";
  const base0 = { state, amount: p.amount, studentName: p.studentName, rollNumber: p.studentRollNumber, label: p.purpose.label, college };
  if (state === "PAID") {
    const r = (await feeRefs(db, c).receipts.doc(onlineReceiptId(orderId)).get()).data() as { receiptNo?: string } | undefined;
    return { ...base0, receiptNo: r?.receiptNo ?? p.receiptNo ?? null, trackingId: p.trackingId ?? null };
  }
  if (state !== "READY") return { ...base0, failureMessage: p.failureMessage ?? null };
  const account = await activeCcavenue(db, c);
  if (!account) return { ...base0, state: "EXPIRED" as const };
  const student = p.studentId ? ((await db.collection("colleges").doc(c).collection("students").doc(p.studentId).get()).data() as { email?: string; mobileNo?: string } | undefined) : undefined;
  const plain = ccavRequestString({
    merchantId: account.merchantId, orderId, amount: p.amount, redirectUrl: returnUrl(base, c), cancelUrl: returnUrl(base, c),
    billingName: p.studentName, billingEmail: student?.email, billingTel: student?.mobileNo,
    merchantParam1: c, merchantParam2: p.purpose.kind === "FEE" ? p.purpose.accountId : undefined,
  });
  return { ...base0, action: CCAVENUE_CHECKOUT_URL[account.env], fields: { encRequest: ccavEncrypt(plain, account.workingKey), access_code: account.accessCode } };
}
