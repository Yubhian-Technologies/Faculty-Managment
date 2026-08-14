import type { Firestore, WriteBatch, DocumentReference } from "firebase-admin/firestore";

// Firestore caps a single batch at 500 operations. Routes that write more
// than one operation per input row (e.g. a student doc + a history entry)
// can exceed that on otherwise-reasonable input sizes, so this transparently
// rotates to a new batch instead of every caller having to reason about the
// limit itself.
const MAX_OPS_PER_BATCH = 450;

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

  async commit(): Promise<void> {
    if (this.opCount > 0) this.pendingCommits.push(this.batch.commit());
    await Promise.all(this.pendingCommits);
  }
}
