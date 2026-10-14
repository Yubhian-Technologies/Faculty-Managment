// Race-proof uniqueness for a master subject: one lock doc per (catalog course
// + regulation + code) and one per (catalog course + regulation + name), kept
// in colleges/{id}/subjectKeys. Same lock-doc pattern as lib/sections/sectionKeys.ts:
// the locks are written in the same transaction as the subject, and a lock whose
// owner is gone or no longer carries that code/name/regulation is stale and is
// taken over.

import { createHash } from "node:crypto";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { normalizeSubjectCode, normalizeSubjectName } from "./subjectIdentity";

export const SUBJECT_KEY_TAKEN = "SUBJECT_KEY_TAKEN";
export class SubjectKeyTakenError extends Error {
  // The live subject that already holds the key, so a caller can reuse it instead of refusing.
  constructor(readonly ownerId?: string, readonly ownerName?: string, readonly field: SubjectKeyField = "code") {
    super(SUBJECT_KEY_TAKEN);
  }
}

export type SubjectKeyField = "code" | "name";

export interface SubjectIdentity {
  /** catalogId when the course has one (siblings share it), else the courseId. */
  scope: string;
  regulation: string;
  code: string;
}

export interface SubjectNameIdentity {
  scope: string;
  regulation: string;
  name: string;
}

export interface SubjectKeyClaim {
  field: SubjectKeyField;
  scope: string;
  regulation: string;
  /** The code or the name (normalized here). */
  value: string;
  /** The subject that will own the key. */
  subjectId: string;
}

const part = (v: unknown) => String(v ?? "").trim().toLowerCase();

// Code keys keep the id they have always had, so locks written before name keys existed stay valid.
export function subjectKeyDocId(i: SubjectIdentity): string {
  const raw = [i.scope, i.regulation, i.code].map(part).join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

export function subjectNameKeyDocId(i: SubjectNameIdentity): string {
  const raw = ["name", i.scope, i.regulation, normalizeSubjectName(i.name)].map(part).join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

export function keyDocId(c: Pick<SubjectKeyClaim, "field" | "scope" | "regulation" | "value">): string {
  return c.field === "code"
    ? subjectKeyDocId({ scope: c.scope, regulation: c.regulation, code: normalizeSubjectCode(c.value) })
    : subjectNameKeyDocId({ scope: c.scope, regulation: c.regulation, name: c.value });
}

function ownerStillHolds(owner: FirebaseFirestore.DocumentSnapshot, c: Pick<SubjectKeyClaim, "field" | "regulation" | "value">): boolean {
  if (!owner.exists) return false;
  if (part(owner.get("regulation")) !== part(c.regulation)) return false;
  return c.field === "code"
    ? normalizeSubjectCode(owner.get("code")) === normalizeSubjectCode(c.value)
    : normalizeSubjectName(owner.get("name")) === normalizeSubjectName(c.value);
}

/**
 * Claims the code lock for one subject inside `tx`. Throws SubjectKeyTakenError when another LIVE subject holds it.
 * (Single-subject form kept for callers and tests; bulk work uses claimSubjectKeys.)
 */
export async function claimSubjectKey(
  tx: Transaction,
  db: Firestore,
  collegeId: string,
  identity: SubjectIdentity,
  subjectRef: DocumentReference,
): Promise<void> {
  const conflicts = await claimSubjectKeys(tx, db, collegeId, [
    { field: "code", scope: identity.scope, regulation: identity.regulation, value: identity.code, subjectId: subjectRef.id },
  ]);
  if (conflicts.length > 0) throw new SubjectKeyTakenError(conflicts[0].ownerId, conflicts[0].ownerName, "code");
}

export interface SubjectKeyConflict {
  claim: SubjectKeyClaim;
  ownerId: string;
  ownerName: string;
  ownerCode: string;
}

/**
 * Reads every lock in `claims` (one batched read, plus one for the owners of
 * locks that already exist). When none is held by a different live subject it
 * writes them all and returns []; otherwise it writes nothing and returns the
 * ones that are held. The caller must then write nothing either.
 */
export async function claimSubjectKeys(
  tx: Transaction,
  db: Firestore,
  collegeId: string,
  claims: SubjectKeyClaim[],
): Promise<SubjectKeyConflict[]> {
  if (claims.length === 0) return [];
  const college = db.collection("colleges").doc(collegeId);
  const keys = college.collection("subjectKeys");
  const keyRefs = claims.map((c) => keys.doc(keyDocId(c)));
  const keySnaps = await tx.getAll(...keyRefs);

  const ownerIds = Array.from(new Set(
    keySnaps.map((k, i) => ({ id: String(k.exists ? k.get("subjectId") ?? "" : ""), mine: claims[i].subjectId }))
      .filter((x) => x.id && x.id !== x.mine).map((x) => x.id)
  ));
  const ownerSnaps = ownerIds.length > 0 ? await tx.getAll(...ownerIds.map((id) => college.collection("subjects").doc(id))) : [];
  const owners = new Map(ownerSnaps.map((o) => [o.id, o]));

  const conflicts: SubjectKeyConflict[] = [];
  claims.forEach((c, i) => {
    const snap = keySnaps[i];
    const ownerId = snap.exists ? String(snap.get("subjectId") ?? "") : "";
    if (!ownerId || ownerId === c.subjectId) return;
    const owner = owners.get(ownerId);
    if (owner && ownerStillHolds(owner, c)) {
      conflicts.push({ claim: c, ownerId, ownerName: String(owner.get("name") ?? ""), ownerCode: String(owner.get("code") ?? "") });
    }
  });
  // All or nothing: no lock is written unless every claim is free (or stale).
  if (conflicts.length === 0) {
    claims.forEach((c, i) => tx.set(keyRefs[i], { subjectId: c.subjectId, field: c.field, updatedAt: new Date() }));
  }
  return conflicts;
}

export const isSubjectKeyTaken = (e: unknown): boolean => e instanceof SubjectKeyTakenError;
