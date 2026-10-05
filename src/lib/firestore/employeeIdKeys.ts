import { createHash } from "node:crypto";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";

// Lock docs that make the employee-ID rule (lib/firestore/employeeIds.ts)
// race-proof. employeeIdTaken is a read-then-write check, so two concurrent
// creates with the same ID can both pass it. Reserving the ID in a lock doc
// first (in a transaction) closes that window:
//
//   faculty  -> global key   employeeIdKeys/f_<hash>          (unique across colleges)
//               college key  colleges/{id}/employeeIdKeys/<hash> (shared with staff)
//   staff    -> college key only
//
// That mirrors the rule exactly: faculty IDs are unique everywhere, and a
// faculty/staff clash only matters inside one college.
//
// The owner is a document that is created AFTER the reservation, so an owner
// that doesn't exist yet counts as live for PENDING_MS; after that (the create
// failed) or when the owner exists but holds a different ID (it was edited),
// the lock is stale and gets taken over.

const PENDING_MS = 2 * 60 * 1000;

export const EMPLOYEE_ID_RESERVED = "EMPLOYEE_ID_RESERVED";
export class EmployeeIdReservedError extends Error {
  constructor(public heldBy: "faculty" | "staff") {
    super(EMPLOYEE_ID_RESERVED);
  }
}

const hash = (id: string) => createHash("sha256").update(id.trim().toLowerCase()).digest("hex").slice(0, 40);

export type EmployeeIdOwner = { collection: "facultyMembers" | "supportingStaff"; id: string };

export async function reserveEmployeeId(
  db: Firestore,
  collegeId: string,
  employeeId: string,
  owner: EmployeeIdOwner,
): Promise<void> {
  const id = employeeId.trim();
  if (!id) return;
  const college = db.collection("colleges").doc(collegeId);
  const keys: { ref: DocumentReference }[] = [{ ref: college.collection("employeeIdKeys").doc(hash(id)) }];
  if (owner.collection === "facultyMembers") keys.unshift({ ref: db.collection("employeeIdKeys").doc(`f_${hash(id)}`) });

  await db.runTransaction(async (tx) => {
    const snaps = await Promise.all(keys.map((k) => tx.get(k.ref)));
    for (let i = 0; i < keys.length; i++) {
      const snap = snaps[i];
      if (!snap.exists) continue;
      const d = snap.data() as { collegeId?: string; ownerCollection?: string; ownerId?: string; reservedAt?: { toMillis?: () => number } | Date };
      if (d.ownerId === owner.id && d.ownerCollection === owner.collection) continue;
      const ownerRef = db.collection("colleges").doc(d.collegeId ?? collegeId).collection(d.ownerCollection ?? "facultyMembers").doc(d.ownerId ?? "_");
      const ownerSnap = await tx.get(ownerRef);
      const reservedAt = d.reservedAt instanceof Date ? d.reservedAt.getTime() : d.reservedAt?.toMillis?.() ?? 0;
      const live = ownerSnap.exists
        ? String(ownerSnap.get("employeeId") ?? "").trim().toLowerCase() === id.toLowerCase()
        : Date.now() - reservedAt < PENDING_MS;
      if (live) throw new EmployeeIdReservedError(d.ownerCollection === "supportingStaff" ? "staff" : "faculty");
    }
    for (const k of keys) {
      tx.set(k.ref, { collegeId, ownerCollection: owner.collection, ownerId: owner.id, reservedAt: new Date() });
    }
  });
}

/**
 * Gives the reservation back when the create that needed it failed, so the
 * retry isn't refused for the grace period. Best effort, and only deletes locks
 * this owner holds.
 */
export async function releaseEmployeeId(
  db: Firestore,
  collegeId: string,
  employeeId: string,
  owner: EmployeeIdOwner,
): Promise<void> {
  const id = employeeId.trim();
  if (!id) return;
  const refs = [db.collection("colleges").doc(collegeId).collection("employeeIdKeys").doc(hash(id))];
  if (owner.collection === "facultyMembers") refs.unshift(db.collection("employeeIdKeys").doc(`f_${hash(id)}`));
  try {
    for (const ref of refs) {
      const snap = await ref.get();
      if (snap.exists && snap.get("ownerId") === owner.id && snap.get("ownerCollection") === owner.collection) await ref.delete();
    }
  } catch {
    // Not fatal: the lock goes stale on its own after PENDING_MS.
  }
}

export const isEmployeeIdReserved = (e: unknown): e is EmployeeIdReservedError => e instanceof EmployeeIdReservedError;
