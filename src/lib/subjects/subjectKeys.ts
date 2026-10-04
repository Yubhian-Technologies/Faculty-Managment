// Race-proof uniqueness for a master subject (catalog course + regulation + code).
// Same lock-doc pattern as lib/sections/sectionKeys.ts: the lock is written in
// the same transaction as the subject, and a lock whose owner is gone or no
// longer carries that code/regulation is stale and gets taken over.

import { createHash } from "node:crypto";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";

export const SUBJECT_KEY_TAKEN = "SUBJECT_KEY_TAKEN";
export class SubjectKeyTakenError extends Error {
  constructor() {
    super(SUBJECT_KEY_TAKEN);
  }
}

export interface SubjectIdentity {
  /** catalogId when the course has one (siblings share it), else the courseId. */
  scope: string;
  regulation: string;
  code: string;
}

export function subjectKeyDocId(i: SubjectIdentity): string {
  const raw = [i.scope, i.regulation, i.code].map((p) => String(p ?? "").trim().toLowerCase()).join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

export async function claimSubjectKey(
  tx: Transaction,
  db: Firestore,
  collegeId: string,
  identity: SubjectIdentity,
  subjectRef: DocumentReference,
): Promise<void> {
  const college = db.collection("colleges").doc(collegeId);
  const keyRef = college.collection("subjectKeys").doc(subjectKeyDocId(identity));
  const keySnap = await tx.get(keyRef);
  if (keySnap.exists) {
    const ownerId = String(keySnap.get("subjectId") ?? "");
    if (ownerId && ownerId !== subjectRef.id) {
      const owner = await tx.get(college.collection("subjects").doc(ownerId));
      const live =
        owner.exists &&
        String(owner.get("code") ?? "").trim().toLowerCase() === identity.code.trim().toLowerCase() &&
        String(owner.get("regulation") ?? "").trim().toLowerCase() === identity.regulation.trim().toLowerCase();
      if (live) throw new SubjectKeyTakenError();
    }
  }
  tx.set(keyRef, { subjectId: subjectRef.id, updatedAt: new Date() });
}

export const isSubjectKeyTaken = (e: unknown): boolean => e instanceof SubjectKeyTakenError;
