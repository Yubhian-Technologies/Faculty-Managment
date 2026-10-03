import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";

// "Guard" documents turn a check-then-write into something Firestore can
// serialise. A transaction that decides "is this cell / this faculty free?"
// from a query and then writes can still lose to another transaction doing the
// same thing at the same moment: both read the old state, both pass. If every
// such transaction ALSO reads and rewrites one shared document first, they all
// contend on that one document, so Firestore runs them one after another and
// each later one re-runs its checks against the earlier one's result.
//
//   section_{sectionId}   - anything that adds/changes slots or assignments in a section
//   faculty_{facultyId}   - anything that places that faculty member in a slot
//
// Guards hold no data that anyone reads - their only job is to be touched. They
// are new, tiny, additive documents; nothing ever needs to clean them up.

const GUARDS = "timetableGuards";

export const sectionGuard = (db: Firestore, collegeId: string, sectionId: string): DocumentReference =>
  db.collection("colleges").doc(collegeId).collection(GUARDS).doc(`section_${sectionId}`);

export const facultyGuard = (db: Firestore, collegeId: string, facultyId: string): DocumentReference =>
  db.collection("colleges").doc(collegeId).collection(GUARDS).doc(`faculty_${facultyId}`);

function uniqueSorted(refs: DocumentReference[]): DocumentReference[] {
  const byPath = new Map(refs.map((r) => [r.path, r]));
  return Array.from(byPath.keys()).sort().map((p) => byPath.get(p)!);
}

/**
 * Reads the guards (taking Firestore's lock on them) - in a fixed, sorted
 * order so two transactions that need overlapping sets of guards can never
 * wait on each other in opposite orders. Call BEFORE any other read-then-write
 * decision in the transaction.
 */
export async function lockGuards(tx: Transaction, refs: DocumentReference[]): Promise<void> {
  const unique = uniqueSorted(refs);
  if (unique.length > 0) await tx.getAll(...unique);
}

/** Rewrites the guards - call after every read, together with the real writes. */
export function bumpGuards(tx: Transaction, refs: DocumentReference[], writer: string): void {
  const at = new Date();
  for (const ref of uniqueSorted(refs)) tx.set(ref, { updatedAt: at, lastWriter: writer }, { merge: true });
}
