// Database-level uniqueness for a class section.
//
// A section is identified by department + course + year + name + cross-listed
// branch (see the duplicate rule in /api/college/sections POST). A "query the
// siblings, compare in memory, then add()" check lets two concurrent requests
// both pass, so every new section also claims a lock doc in
// colleges/{id}/sectionKeys (doc id = hash of the identity), written in the
// SAME transaction as the section. Same pattern as departmentKeys.
//
// A lock whose owner no longer exists, or whose owner's identity has since
// changed (renamed / moved year), is stale and is taken over - so deleting or
// editing a section never needs to release anything.

import { createHash } from "node:crypto";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";

export const SECTION_KEY_TAKEN = "SECTION_KEY_TAKEN";

export interface SectionIdentity {
  department: string;
  courseId: string;
  year: number | string;
  name: string;
  secondaryDepartment?: string;
}

export class SectionKeyTakenError extends Error {
  constructor() {
    super(SECTION_KEY_TAKEN);
  }
}

export function sectionKeyDocId(i: SectionIdentity): string {
  const raw = [i.department, i.courseId, String(Number(i.year)), i.name, i.secondaryDepartment ?? ""]
    .map((p) => String(p).trim().toLowerCase())
    .join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

function identityOfDoc(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const sec = Array.isArray(data.secondaryDepartments) ? String(data.secondaryDepartments[0] ?? "") : "";
  return sectionKeyDocId({
    department: String(data.department ?? ""),
    courseId: String(data.courseId ?? ""),
    year: Number(data.year),
    name: String(data.name ?? ""),
    secondaryDepartment: sec,
  });
}

/**
 * Claims the lock for `sectionRef` inside `tx`. Performs its reads first; the
 * caller must do its own writes afterwards. Throws SectionKeyTakenError when a
 * different, still-matching section holds the identity.
 */
export async function claimSectionKey(
  tx: Transaction,
  db: Firestore,
  collegeId: string,
  identity: SectionIdentity,
  sectionRef: DocumentReference,
): Promise<void> {
  const keyId = sectionKeyDocId(identity);
  const keyRef = db.collection("colleges").doc(collegeId).collection("sectionKeys").doc(keyId);
  const keySnap = await tx.get(keyRef);
  if (keySnap.exists) {
    const ownerId = String(keySnap.get("sectionId") ?? "");
    if (ownerId && ownerId !== sectionRef.id) {
      const ownerSnap = await tx.get(db.collection("colleges").doc(collegeId).collection("sections").doc(ownerId));
      if (ownerSnap.exists && identityOfDoc(ownerSnap.data()) === keyId) throw new SectionKeyTakenError();
    }
  }
  tx.set(keyRef, { sectionId: sectionRef.id, updatedAt: new Date() });
}

export const isSectionKeyTaken = (err: unknown): boolean => err instanceof SectionKeyTakenError;
