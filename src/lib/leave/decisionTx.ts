import type { Firestore } from "firebase-admin/firestore";
import type { LeaveTypeCode, LeaveTypeFull } from "@/types/leave";
import {
  BALANCES_COL, REQUESTS_COL, balanceDocId, balanceIdentity, commitPatch, computeFallbackEntitled,
  releaseApprovalPatch, releasePendingPatch, type BalanceCounters,
} from "./balanceEngine";

// One leave decision = one transaction. The status precondition, the balance
// change and the status update used to be three separate steps on top of a
// request read taken at the start of the handler, so a double-click or two
// approvers deducted the balance twice, and a failed status update left a
// consumed balance behind. Here they commit together or not at all, and the
// request must still be exactly what the decider looked at.

/** The request is gone, or is no longer what the decider saw (already decided, edited, cancelled...). */
export class LeaveStateConflictError extends Error {
  readonly code = "LEAVE_STATE_CONFLICT";
  constructor(message = "This leave request was just decided or changed by someone else - refresh and review it again.") {
    super(message);
    this.name = "LeaveStateConflictError";
  }
}

export type BalanceEffect =
  /** Approval: charge as many days as the balance covers; the rest becomes Loss of Pay. */
  | { kind: "COMMIT_SPLIT"; uid: string; code: LeaveTypeCode; year: number; days: number; leaveType: LeaveTypeFull }
  /** Rejection / cancel-while-pending. */
  | { kind: "RELEASE_PENDING"; uid: string; code: LeaveTypeCode; year: number; days: number }
  /** Cancel-after-approval: give the committed days back. */
  | { kind: "RELEASE_APPROVAL"; uid: string; code: LeaveTypeCode; year: number; days: number };

export interface LeaveTransition {
  db: Firestore;
  collegeId: string;
  id: string;
  /**
   * What the decider looked at. `status` must still match; `updatedAt`, when
   * both sides carry one, must too - that is what catches the requester editing
   * the dates (and so the days/year the balance is charged against) between
   * the read and the decision.
   */
  expected: { status: string; updatedAt?: unknown };
  balance?: BalanceEffect;
  /** Builds the request-document update; `lopDays` is 0 unless the balance effect produced some. */
  buildUpdate: (result: { lopDays: number }) => Record<string, unknown>;
}

function millisOf(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  const o = v as { toMillis?: () => number; toDate?: () => Date; _seconds?: number; seconds?: number; _nanoseconds?: number; nanoseconds?: number };
  if (typeof o.toMillis === "function") return o.toMillis();
  if (typeof o.toDate === "function") return o.toDate().getTime();
  const sec = o._seconds ?? o.seconds;
  if (typeof sec === "number") return sec * 1000 + Math.floor((o._nanoseconds ?? o.nanoseconds ?? 0) / 1e6);
  return null;
}

class NeedsFallbackEntitlement extends Error {}

export async function transitionLeaveRequest(t: LeaveTransition): Promise<{ lopDays: number }> {
  const { db, collegeId, id, expected, balance } = t;
  const reqRef = REQUESTS_COL(collegeId, db).doc(id);
  const balRef = balance
    ? BALANCES_COL(collegeId, db).doc(balanceDocId(balance.uid, balance.code, balance.year))
    : null;

  // Only an approval against a balance doc with no `entitled` needs the
  // profile-derived default, and that costs two extra reads - so look first
  // (outside the transaction, where reads are free to be slow) rather than
  // pay for it on every decision.
  let fallbackEntitled: number | undefined;
  const needFallback = async () => {
    if (balance?.kind !== "COMMIT_SPLIT") return;
    fallbackEntitled = await computeFallbackEntitled(db, collegeId, balance.uid, balance.leaveType);
  };
  if (balance?.kind === "COMMIT_SPLIT" && balRef) {
    const pre = (await balRef.get()).data() as BalanceCounters | undefined;
    if (pre?.entitled === undefined) await needFallback();
  }

  for (let attempt = 0; ; attempt++) {
    try {
      return await db.runTransaction(async (tx) => {
        const [reqSnap, balSnap] = await Promise.all([tx.get(reqRef), balRef ? tx.get(balRef) : Promise.resolve(null)]);
        if (!reqSnap.exists) throw new LeaveStateConflictError("This leave request no longer exists.");
        const current = reqSnap.data() as { status?: string; updatedAt?: unknown };
        if (current.status !== expected.status) throw new LeaveStateConflictError();
        const before = millisOf(expected.updatedAt);
        const now = millisOf(current.updatedAt);
        if (before != null && now != null && before !== now) throw new LeaveStateConflictError();

        let lopDays = 0;
        if (balance && balRef) {
          const counters = (balSnap?.data() ?? {}) as BalanceCounters;
          let patch: Record<string, number> | null = null;
          if (balance.kind === "COMMIT_SPLIT") {
            const entitled = counters.entitled ?? fallbackEntitled;
            if (entitled === undefined) throw new NeedsFallbackEntitlement();
            const remaining = Math.max(0, entitled - (counters.used ?? 0));
            const within = Math.min(balance.days, remaining);
            lopDays = balance.days - within;
            if (within > 0) patch = commitPatch(counters, within);
          } else if (balance.kind === "RELEASE_PENDING") {
            patch = releasePendingPatch(counters, balance.days);
          } else {
            patch = releaseApprovalPatch(counters, balance.days);
          }
          if (patch) {
            tx.set(
              balRef,
              { ...balanceIdentity(collegeId, balance.uid, balance.code, balance.year), ...patch, updatedAt: new Date() },
              { merge: true }
            );
          }
        }
        tx.update(reqRef, t.buildUpdate({ lopDays }));
        return { lopDays };
      });
    } catch (err) {
      if (err instanceof NeedsFallbackEntitlement && attempt === 0) {
        await needFallback();
        continue;
      }
      throw err;
    }
  }
}
