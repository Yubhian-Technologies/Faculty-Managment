import type { Firestore } from "firebase-admin/firestore";

// Prevents two Distribute runs racing on the same cohort (e.g. two HODs, or
// two browser tabs) from both reading the "before" state and both writing,
// which would silently interleave two different distribution plans. Mirrors
// the transactional re-check-then-claim idiom already used for exactly this
// kind of race in hiring-batches/route.ts's ALREADY_BATCHED guard - a small
// doc, checked-and-set inside a real Firestore transaction - rather than a
// bespoke new locking mechanism.
//
// A lock older than STALE_MS is treated as abandoned (the request that took
// it crashed or timed out before releasing) and is reclaimable rather than
// blocking forever.
const STALE_MS = 2 * 60 * 1000;

export class DistributionLockHeldError extends Error {
  constructor(lockKey: string) {
    super(`DISTRIBUTION_LOCKED:${lockKey}`);
    this.name = "DistributionLockHeldError";
  }
}

function lockRef(db: Firestore, collegeId: string, lockKey: string) {
  return db.collection("colleges").doc(collegeId).collection("distributionLocks").doc(lockKey);
}

export async function acquireDistributionLock(
  db: Firestore,
  collegeId: string,
  lockKey: string,
  actorUid: string
): Promise<void> {
  const ref = lockRef(db, collegeId, lockKey);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data() as { inProgress?: boolean; startedAt?: FirebaseFirestore.Timestamp };
      const startedAtMs = data.startedAt?.toDate?.().getTime() ?? 0;
      const isStale = Date.now() - startedAtMs > STALE_MS;
      if (data.inProgress && !isStale) {
        throw new DistributionLockHeldError(lockKey);
      }
    }
    tx.set(ref, { inProgress: true, startedAt: new Date(), actorUid });
  });
}

export async function releaseDistributionLock(db: Firestore, collegeId: string, lockKey: string): Promise<void> {
  await lockRef(db, collegeId, lockKey).delete();
}
