import type { Firestore } from "firebase-admin/firestore";
import { REQUESTS_COL } from "./balanceEngine";
import type { LeaveRequest } from "@/types/leave";

// "One outstanding request at a time" used to be a check (read the person's
// requests, look for a pending one) followed by a separate add() - two
// submissions landing together (a double-click, a retried request, two tabs)
// both passed the check and both created a request. The check and the create
// now happen in ONE transaction that also reads-and-writes a per-employee
// guard document: concurrent submissions for the same person all touch that
// one document, so they serialise, and the later one re-runs its check
// against the earlier one's request instead of racing it.
//
// The guard collection is new and additive; a guard document carries no
// meaning beyond "the last submission's id", so it can never block anyone and
// needs no cleanup.

export const SUBMISSION_GUARDS_COL = (collegeId: string, db: Firestore) =>
  db.collection("colleges").doc(collegeId).collection("leaveSubmissionGuards");

const PENDING_STATUSES = new Set([
  "PENDING_ACCEPTANCE", "PENDING_HOD", "PENDING_PRINCIPAL", "PENDING_VICE_PRINCIPAL", "PENDING_MANAGEMENT",
]);

export function isPendingStatus(status: unknown): boolean {
  return typeof status === "string" && PENDING_STATUSES.has(status);
}

export const DUPLICATE_SUBMISSION_MESSAGE =
  "You already have a leave request pending approval. Please wait for it to be decided before applying again.";

export class DuplicateLeaveSubmissionError extends Error {
  constructor() {
    super(DUPLICATE_SUBMISSION_MESSAGE);
    this.name = "DuplicateLeaveSubmissionError";
  }
}

/** Creates the request unless this employee already has one awaiting a decision. Returns the new id. */
export async function createLeaveRequestOnce(
  db: Firestore,
  collegeId: string,
  uid: string,
  newRequest: Omit<LeaveRequest, "id">
): Promise<string> {
  const requests = REQUESTS_COL(collegeId, db);
  const guardRef = SUBMISSION_GUARDS_COL(collegeId, db).doc(uid);
  const requestRef = requests.doc();

  await db.runTransaction(async (tx) => {
    const [, existing] = await Promise.all([tx.get(guardRef), tx.get(requests.where("uid", "==", uid))]);
    if (existing.docs.some((d) => isPendingStatus((d.data() as { status?: string }).status))) {
      throw new DuplicateLeaveSubmissionError();
    }
    tx.set(guardRef, { collegeId, uid, lastRequestId: requestRef.id, updatedAt: new Date() });
    tx.set(requestRef, newRequest);
  });
  return requestRef.id;
}
