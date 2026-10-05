import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { MAX_OPS_PER_BATCH } from "./chunkedBatch";

// ChunkedBatch starts every chunk's commit immediately and never waits for the
// previous one, so when a set of writes spans more than one chunk they land in
// parallel and in no guaranteed order: a later chunk can succeed while an
// earlier one fails. For a cascade that matters - deleting a parent in the
// last chunk while a child chunk fails strands the children for good, with
// nothing left to retry from.
//
// This deletes in the order given, ONE committed chunk at a time, and stops at
// the first failure. Put children first and the parent last and a failure
// leaves the parent standing, so the same call can simply be repeated: what is
// already gone is not found again, and the rest is finished.

export async function deleteInOrder(db: Firestore, refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += MAX_OPS_PER_BATCH) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + MAX_OPS_PER_BATCH)) batch.delete(ref);
    await batch.commit();
  }
}
