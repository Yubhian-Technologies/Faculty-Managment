import type { Payment } from "@/types";
import type { FeeReceipt, StudentFeeAccount } from "@/types/fees";
import { allocationOf, recompute } from "./rules";

// Online fee payments (CCAvenue) on a student's fee account (pure - used inside the settlement transaction,
// lib/payments/settle.ts, and the refund). A successful payment becomes a fee receipt with the payment's own
// receipt number (the shared FR- series), allocated oldest first by head + bank account; paying more than is due
// is never absorbed - the payment is flagged for a refund instead.

export const onlineReceiptId = (orderId: string) => `ol_${orderId}`;

/** The smallest online payment allowed: the oldest instalment still due (or the balance, if smaller). */
export function minimumOnline(a: Pick<StudentFeeAccount, "instalments" | "paid" | "balance">): number {
  let left = Math.max(0, a.paid);
  for (const x of a.instalments) {
    const paid = Math.min(x.amount, left);
    left -= paid;
    if (x.amount - paid > 0) return Math.min(x.amount - paid, Math.max(0, a.balance));
  }
  return Math.max(0, a.balance);
}

/** Checks the amount a student wants to pay online now. */
export function onlineAmountError(a: Pick<StudentFeeAccount, "instalments" | "paid" | "balance">, amount: number): string | null {
  if (a.balance <= 0) return "Nothing is due on this fee.";
  if (!Number.isInteger(amount) || amount <= 0) return "Enter the amount in whole rupees.";
  if (amount > a.balance) return `That is more than the balance (Rs. ${a.balance}).`;
  const min = minimumOnline(a);
  if (amount < min) return `Pay at least Rs. ${min} (the instalment due now).`;
  return null;
}

/** What a successful online payment does to the account: the receipt + the account after it, or `excess`. */
export function applyOnlinePayment(a: StudentFeeAccount, p: Pick<Payment, "id" | "amount" | "trackingId" | "bankRefNo" | "paymentMode">, receiptNo: string, at: string):
  { excess: true } | { excess: false; receipt: FeeReceipt; account: StudentFeeAccount } {
  if (p.amount > a.balance) return { excess: true };
  const receipt: FeeReceipt = {
    id: onlineReceiptId(p.id), receiptNo, academicYear: a.academicYear, accountId: a.id, studentId: a.studentId, rollNumber: a.rollNumber, name: a.name,
    department: a.department, section: a.section, courseName: a.courseName, amount: p.amount, source: "ONLINE", mode: "ONLINE",
    reference: p.trackingId ?? p.id, ...(p.bankRefNo ? { bank: `Bank ref ${p.bankRefNo}` } : {}), paidOn: istDate(at),
    allocation: allocationOf(a, p.amount), paymentId: p.id, ...(p.paymentMode ? { remarks: `Online - ${p.paymentMode}` } : {}),
    cancelled: null, createdAt: at, byName: "Online (CCAvenue)",
  };
  const paid = a.paid + p.amount;
  const account: StudentFeeAccount = {
    ...a, ...recompute({ ...a, paid }), paid, rev: a.rev + 1, updatedAt: at, updatedByName: "Online (CCAvenue)",
    history: [...(a.history ?? []), { at, byName: "Online (CCAvenue)", action: "PAID", detail: `${receiptNo} Rs. ${p.amount} ONLINE` }].slice(-50),
  };
  return { excess: false, receipt, account };
}

/** A full refund of an online fee payment: its receipt is cancelled and the amount comes off what was paid. */
export function refundOnlinePayment(a: StudentFeeAccount, r: FeeReceipt, at: string, byName: string, reason: string): { receipt: FeeReceipt; account: StudentFeeAccount } | null {
  if (r.cancelled) return null;
  const paid = Math.max(0, a.paid - r.amount);
  return {
    receipt: { ...r, cancelled: { at, byName, reason } },
    account: { ...a, ...recompute({ ...a, paid }), paid, rev: a.rev + 1, updatedAt: at, updatedByName: byName, history: [...(a.history ?? []), { at, byName, action: "RECEIPT_CANCELLED", detail: `${r.receiptNo}: refunded online payment` }].slice(-50) },
  };
}

const istDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso));
