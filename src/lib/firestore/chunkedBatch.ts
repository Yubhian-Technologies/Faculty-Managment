import type { Firestore, WriteBatch, DocumentReference } from "firebase-admin/firestore";

// Firestore caps a single batch at 500 operations. Routes that write more
// than one operation per input row (e.g. a student doc + a history entry)
// can exceed that on otherwise-reasonable input sizes, so this transparently
// rotates to a new batch instead of every caller having to reason about the
// limit itself.
//
// Exported so callers that need to correlate their own per-row side effects
// (e.g. a Firebase Auth account created outside this batch) with which
// physical chunk a row's writes landed in can rotate their own bookkeeping
// on the same boundary - see getCurrentChunkIndex() below.
export const MAX_OPS_PER_BATCH = 450;

// commit() rejects with this (instead of a bare error) so a caller that
// tracks per-chunk side effects can roll back only the chunks that actually
// failed, not every chunk in the whole request - earlier chunks already
// committed durably to Firestore by the time a later chunk's commit() rejects
// (each chunk commits independently, this class provides no cross-chunk
// atomicity), so treating the whole request as failed would undo bookkeeping
// for writes that already succeeded.
export class ChunkedBatchError extends Error {
  readonly failedChunkIndexes: number[];
  constructor(message: string, failedChunkIndexes: number[]) {
    super(message);
    this.name = "ChunkedBatchError";
    this.failedChunkIndexes = failedChunkIndexes;
  }
}

export class ChunkedBatch {
  private db: Firestore;
  private batch: WriteBatch;
  private opCount = 0;
  private pendingCommits: Promise<unknown>[] = [];

  constructor(db: Firestore) {
    this.db = db;
    this.batch = db.batch();
  }

  private rotateIfFull() {
    if (this.opCount >= MAX_OPS_PER_BATCH) {
      this.pendingCommits.push(this.batch.commit());
      this.batch = this.db.batch();
      this.opCount = 0;
    }
  }

  set(ref: DocumentReference, data: object): void {
    this.rotateIfFull();
    this.batch.set(ref, data);
    this.opCount++;
  }

  update(ref: DocumentReference, data: object): void {
    this.rotateIfFull();
    this.batch.update(ref, data);
    this.opCount++;
  }

  delete(ref: DocumentReference): void {
    this.rotateIfFull();
    this.batch.delete(ref);
    this.opCount++;
  }

  // The index of the chunk the most recent write landed in - call right
  // after writing a logical group (e.g. one imported row's docs) to record
  // which physical batch it belongs to. Not retroactive: if a group's writes
  // happen to straddle a rotation, this reports the chunk its last op landed
  // in.
  getCurrentChunkIndex(): number {
    return this.pendingCommits.length;
  }

  async commit(): Promise<void> {
    if (this.opCount > 0) this.pendingCommits.push(this.batch.commit());
    const results = await Promise.allSettled(this.pendingCommits);
    const failedChunkIndexes = results
      .map((r, i) => (r.status === "rejected" ? i : -1))
      .filter((i) => i >= 0);
    if (failedChunkIndexes.length > 0) {
      const firstFailure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      const message = firstFailure?.reason instanceof Error ? firstFailure.reason.message : "Batch commit failed";
      throw new ChunkedBatchError(message, failedChunkIndexes);
    }
  }
}
