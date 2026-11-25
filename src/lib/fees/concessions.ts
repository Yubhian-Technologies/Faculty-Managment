import type { Firestore } from "firebase-admin/firestore";
import type { FeeConcession, FeeConcessionRequest, StudentFeeAccount } from "@/types/fees";
import { FeeError, feeRefs, withConcession } from "./server";

// Fee concession requests (types/fees.ts FeeConcessionRequest): the College Office asks - student, amount (on a head or
// the whole fee), reason, referral name, the letter (PDF) - and Management approves (the amount asked or less) or
// rejects. Approving adds the concession to the student's fee account in the same transaction, so a request is
// applied exactly once. The College Office may withdraw a request still pending.

type Db = Firestore;
export const MAX_LETTER_BYTES = 5 * 1024 * 1024;

export interface NewRequestInput { accountId: string; amount: unknown; headId?: unknown; reason: unknown; referralName: unknown; referralDetails?: unknown }

/** Checks a new request against the student's account; returns the request fields (without the letter), or throws. */
export async function checkNewRequest(db: Db, c: string, input: NewRequestInput) {
  const refs = feeRefs(db, c);
  const snap = await refs.accounts.doc(input.accountId).get();
  if (!snap.exists) throw new FeeError("Fee account not found. Fees must be raised for the student first.", 404);
  const a = snap.data() as StudentFeeAccount;
  const amount = Number(input.amount);
  const reason = String(input.reason ?? "").trim().slice(0, 500);
  const referralName = String(input.referralName ?? "").trim().slice(0, 100);
  const referralDetails = String(input.referralDetails ?? "").trim().slice(0, 200);
  if (!Number.isInteger(amount) || amount <= 0) throw new FeeError("Enter the concession in whole rupees.");
  if (amount > a.studentShare) throw new FeeError(`The concession can be at most Rs. ${a.studentShare} (what the student pays now).`);
  if (!reason) throw new FeeError("Enter the reason for the concession.");
  if (!referralName) throw new FeeError("Enter the referral name.");
  const head = input.headId ? a.heads.find((h) => h.headId === input.headId) : null;
  if (input.headId && !head) throw new FeeError("The fee head is not on this student's fee.");
  if (head && amount > head.student) throw new FeeError(`On ${head.name} the concession can be at most Rs. ${head.student}.`);
  const pending = await refs.concessionRequests.where("accountId", "==", a.id).where("status", "==", "PENDING").get();
  if (!pending.empty) throw new FeeError("A concession request for this student is already waiting for Management.", 409);
  return { account: a, amount, reason, referralName, referralDetails, head };
}

/** Management's decision. APPROVE applies `amount` (default: the amount asked; never more) to the account. */
export async function decideRequest(db: Db, c: string, input: { requestId: string; action: unknown; amount?: unknown; remarks?: unknown; byName: string }) {
  const refs = feeRefs(db, c);
  const remarks = String(input.remarks ?? "").trim().slice(0, 500);
  if (input.action !== "APPROVE" && input.action !== "REJECT") throw new FeeError("Choose approve or reject.");
  if (input.action === "REJECT" && !remarks) throw new FeeError("Enter the reason for rejecting.");
  return db.runTransaction(async (tx) => {
    const ref = refs.concessionRequests.doc(input.requestId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new FeeError("Concession request not found. It may have been deleted.", 404);
    const r = snap.data() as FeeConcessionRequest;
    if (r.status !== "PENDING") throw new FeeError(`This request is already ${r.status.toLowerCase()}.`, 409);
    const at = new Date().toISOString();
    if (input.action === "REJECT") {
      const next: FeeConcessionRequest = { ...r, status: "REJECTED", decidedByName: input.byName, decidedAt: at, remarks };
      tx.set(ref, next);
      return { request: next, account: null as StudentFeeAccount | null };
    }
    const amount = input.amount === undefined || input.amount === "" || input.amount === null ? r.amount : Number(input.amount);
    if (!Number.isInteger(amount) || amount <= 0) throw new FeeError("Enter the amount to approve in whole rupees.");
    if (amount > r.amount) throw new FeeError(`You can approve at most the Rs. ${r.amount} asked.`);
    const aRef = refs.accounts.doc(r.accountId);
    const aSnap = await tx.get(aRef);
    if (!aSnap.exists) throw new FeeError("The student's fee account is not found. It may have been deleted.", 404);
    const a = aSnap.data() as StudentFeeAccount;
    if (amount > a.studentShare) throw new FeeError(`The student now pays Rs. ${a.studentShare} - approve at most that.`, 409);
    const con: FeeConcession = {
      id: `cr_${r.id}`, amount, headId: r.headId ?? null, headName: r.headName ?? null, reason: r.reason, referralName: r.referralName, requestId: r.id, at, byName: input.byName,
    };
    const account = withConcession(a, con, at, input.byName);
    const next: FeeConcessionRequest = { ...r, status: "APPROVED", decidedByName: input.byName, decidedAt: at, approvedAmount: amount, ...(remarks ? { remarks } : {}) };
    tx.set(aRef, account);
    tx.set(ref, next);
    return { request: next, account };
  });
}
