import type { Firestore } from "firebase-admin/firestore";
import { rollNumberUpperOf, studentRollDocId, studentRollKey } from "@/lib/students/loginDefaults";

// The GLOBAL roll-number registry: studentUsernames/{KEY}, one document per
// normalised roll (see loginDefaults.ts), shared by every college.
//
// Roll numbers are unique across all colleges. A scan of every college's students
// can't enforce that (and Firestore has no collection-group index on the roll),
// so uniqueness is enforced where Firestore can do it atomically - on a document
// id. A roll is CLAIMED, in a transaction, whenever a student is added, imported
// or has their roll changed; the same document later carries the login (`uid`,
// `loginEmail`) so the login page can find it by that same id, with no query.
//
// A registry document is `active: true` while its student holds the roll and
// `active: false` once it is retired (the student was archived, or moved to a
// different roll) - a retired roll can be claimed again. Graduating a student
// does NOT retire it: the student still exists.
//
// LIMITS: documents only exist for students written since this registry was
// introduced; students from before it are covered once
// scripts/backfill-student-roll-keys.mjs has run. Until then a roll that exists
// only on an old student in ANOTHER college is not seen here (the writer's own
// college is still checked against its actual students).

export const REGISTRY_COLLECTION = "studentUsernames";

export interface RollClaim {
  roll: string;
  collegeId: string;
  studentDocId: string;
  name?: string;
  /** The student's login uid, when they have one - lets a legacy registry document (written before it recorded the student) be recognised as theirs. */
  uid?: string;
}

export interface RollHolder {
  collegeId?: string;
  studentDocId?: string;
  name?: string;
  /** Held by a student of the same college as the caller (so the name may be shown). */
  sameCollege: boolean;
}

export type ClaimResult =
  | { ok: true; created: boolean }
  | { ok: false; code: "INVALID_ROLL" }
  | { ok: false; code: "TAKEN"; holder: RollHolder };

interface RegistryDoc {
  rollKey?: string;
  rollNumber?: string;
  collegeId?: string;
  studentDocId?: string;
  name?: string;
  uid?: string;
  loginEmail?: string;
  active?: boolean;
  createdAt?: unknown;
}

// A claim is written just BEFORE its student document, so a registry document
// whose student does not exist is normally a claim still being completed. Only
// after this long is it treated as stale (a leftover from a student that was
// hard-deleted by older code) and allowed to be taken over.
export const STALE_CLAIM_AFTER_MS = 15 * 60 * 1000;

function millisOf(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  const v = value as { toMillis?: () => number } | null | undefined;
  if (v && typeof v.toMillis === "function") return v.toMillis();
  return typeof value === "number" ? value : null;
}

function isMine(doc: RegistryDoc, claim: RollClaim): boolean {
  if (doc.collegeId === claim.collegeId && doc.studentDocId === claim.studentDocId) return true;
  // A legacy document that never recorded its student: recognised by its login.
  return !doc.studentDocId && !!claim.uid && doc.uid === claim.uid;
}

export function registryRef(db: Firestore, roll: string) {
  return db.collection(REGISTRY_COLLECTION).doc(studentRollDocId(roll));
}

/**
 * Claims a roll for a student: ok when it was free, retired, stale, or already this
 * student's; TAKEN (with who holds it) when another live student has it.
 * Idempotent for the same student. Concurrent claims of one roll cannot both win.
 */
export async function claimStudentRoll(db: Firestore, claim: RollClaim, now: Date = new Date()): Promise<ClaimResult> {
  const key = studentRollKey(claim.roll);
  if (!key) return { ok: false, code: "INVALID_ROLL" };
  const ref = registryRef(db, claim.roll);

  return db.runTransaction(async (tx): Promise<ClaimResult> => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? (snap.data() as RegistryDoc) : null;

    if (cur && cur.active !== false) {
      if (isMine(cur, claim)) {
        // Keep the display fields current; never disturb the login fields.
        // (createdAt is stamped on a legacy document that lacks one, so the
        // staleness rule below can never mistake a just-adopted entry for a leftover.)
        tx.set(ref, { rollNumber: claim.roll.trim(), rollNumberUpper: rollNumberUpperOf(claim.roll), rollKey: key, collegeId: claim.collegeId, studentDocId: claim.studentDocId, ...(claim.name ? { name: claim.name } : {}), ...(cur.createdAt ? {} : { createdAt: now }) }, { merge: true });
        return { ok: true, created: false };
      }
      // Another student's claim - unless it is a stale leftover.
      let stale = false;
      if (cur.collegeId && cur.studentDocId) {
        const holderStudent = await tx.get(db.collection("colleges").doc(cur.collegeId).collection("students").doc(cur.studentDocId));
        const age = millisOf(cur.createdAt);
        stale = !holderStudent.exists && (age === null || now.getTime() - age > STALE_CLAIM_AFTER_MS);
      }
      if (!stale) {
        return {
          ok: false,
          code: "TAKEN",
          holder: { collegeId: cur.collegeId, studentDocId: cur.studentDocId, name: cur.name, sameCollege: cur.collegeId === claim.collegeId },
        };
      }
    }

    // Free, retired or stale: (re)write the whole document - no merge, so a retired
    // holder's login fields never carry over to the new student.
    tx.set(ref, {
      rollKey: key,
      rollNumber: claim.roll.trim(),
      rollNumberUpper: rollNumberUpperOf(claim.roll),
      collegeId: claim.collegeId,
      studentDocId: claim.studentDocId,
      ...(claim.name ? { name: claim.name } : {}),
      active: true,
      createdAt: now,
    });
    return { ok: true, created: true };
  });
}

/** Message for a TAKEN claim. Names the holder only when they are in the caller's own college. */
export function rollTakenMessage(roll: string, holder: RollHolder): string {
  if (holder.sameCollege) {
    return `Roll number ${roll} is already assigned to ${holder.name?.trim() || "another student"}. Roll numbers must be unique.`;
  }
  return `Roll number ${roll} is already registered to a student in another college. Roll numbers must be unique across all colleges.`;
}

/**
 * Undoes a claim THIS call just created (the student write that was meant to
 * follow it failed). Removes it only if it is still this student's and has no
 * login on it - never someone else's, never a live login's.
 */
export async function releaseStudentRoll(db: Firestore, roll: string, collegeId: string, studentDocId: string): Promise<void> {
  if (!studentRollKey(roll)) return;
  const ref = registryRef(db, roll);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const cur = snap.data() as RegistryDoc;
    if (cur.collegeId === collegeId && cur.studentDocId === studentDocId && !cur.uid && !cur.loginEmail) tx.delete(ref);
  });
}

/**
 * Retires the registry documents that point at this student - the one for their
 * roll and any (legacy) one that carries their login - without deleting them.
 * Their roll becomes claimable again. Used when a student is archived.
 */
export async function retireStudentRoll(
  db: Firestore,
  student: { roll?: string; collegeId: string; studentDocId: string; uid?: string },
  now: Date = new Date(),
  extra: Record<string, unknown> = {}
): Promise<void> {
  const retire = { active: false, retiredAt: now, ...extra };
  const done = new Set<string>();

  if (student.roll && studentRollKey(student.roll)) {
    const ref = registryRef(db, student.roll);
    const snap = await ref.get();
    if (snap.exists) {
      const cur = snap.data() as RegistryDoc;
      if (isMine(cur, { roll: student.roll, collegeId: student.collegeId, studentDocId: student.studentDocId, uid: student.uid })) {
        await ref.update(retire);
      }
    }
    done.add(ref.path);
  }
  if (student.uid) {
    const byUid = await db.collection(REGISTRY_COLLECTION).where("uid", "==", student.uid).get();
    await Promise.all(byUid.docs.filter((d) => !done.has(d.ref.path)).map((d) => d.ref.update(retire)));
  }
}
