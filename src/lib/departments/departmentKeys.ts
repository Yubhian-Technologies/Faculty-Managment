// Database-level uniqueness for department name / short code.
//
// Firestore cannot declare a unique index, so a plain "read every department,
// loop, then write" check (what create/rename used to do) lets two concurrent
// requests both pass. Instead every department reserves its normalised name
// and code as lock docs in colleges/{id}/departmentKeys, written in the SAME
// transaction as the department doc itself. Doc id = a hash of the normalised
// key, value = owning departmentId. A second department claiming the same key
// finds the doc, sees a different (still existing) owner, and the transaction
// aborts with DEPARTMENT_KEY_TAKEN.
//
// The collection is server-only (Admin SDK); firestore.rules denies clients.
// Cross-field overlap (a name equal to another department's code) is checked
// against the departments read inside the same transaction by the caller via
// findDepartmentConflict (resolve.ts).

import { createHash } from "node:crypto";
import { normalizeDepartmentCode, normalizeDepartmentName } from "./resolve";

export const DEPARTMENT_KEY_TAKEN = "DEPARTMENT_KEY_TAKEN";

export function departmentKeyDocId(field: "name" | "code", raw: string | undefined | null): string {
  const norm = field === "name" ? normalizeDepartmentName(raw) : normalizeDepartmentCode(raw);
  return `${field}_${createHash("sha256").update(norm).digest("hex").slice(0, 40)}`;
}

// Structural types: satisfied by firebase-admin refs/transactions and by the
// in-memory fake used in tests.
interface DocSnapLike {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
interface RefLike {
  id: string;
}
interface TxLike {
  get(ref: never): Promise<DocSnapLike>;
  set(ref: never, data: Record<string, unknown>): unknown;
  delete(ref: never): unknown;
}
interface CollLike {
  doc(id: string): RefLike;
}

export interface KeyPair {
  name?: string;
  code?: string;
}

export class DepartmentKeyTakenError extends Error {
  constructor(public field: "name" | "code", message: string) {
    super(`${DEPARTMENT_KEY_TAKEN}:${field}:${message}`);
  }
}

/**
 * Claims the name/code lock docs for `deptId` and releases the ones it held
 * under `prev`. MUST be called inside a transaction, after the caller's own
 * reads and before its writes (it performs its own reads first, then writes).
 * Only keys that actually change are touched, so re-saving unchanged values or
 * changing only case/whitespace (same normalised key) is a no-op.
 */
export async function claimDepartmentKeys(
  tx: TxLike,
  keys: CollLike,
  departments: CollLike,
  deptId: string,
  next: KeyPair,
  prev: KeyPair = {}
): Promise<void> {
  const plan: { field: "name" | "code"; nextId?: string; prevId?: string; label: string }[] = [];
  for (const field of ["name", "code"] as const) {
    if (next[field] === undefined) continue;
    const nextId = departmentKeyDocId(field, next[field]);
    const prevId = prev[field] ? departmentKeyDocId(field, prev[field]) : undefined;
    plan.push({ field, nextId: nextId === prevId ? undefined : nextId, prevId: nextId === prevId ? undefined : prevId, label: (next[field] ?? "").trim() });
  }

  // ---- reads ----
  const checks: { field: "name" | "code"; label: string; ref: RefLike; snap: DocSnapLike }[] = [];
  for (const p of plan) {
    if (!p.nextId) continue;
    const ref = keys.doc(p.nextId);
    checks.push({ field: p.field, label: p.label, ref, snap: await tx.get(ref as never) });
  }
  // Only release a previous lock this department actually owns (a legacy
  // duplicate's lock belongs to someone else and must be left alone).
  const releases: RefLike[] = [];
  for (const p of plan) {
    if (!p.prevId) continue;
    const ref = keys.doc(p.prevId);
    const snap = await tx.get(ref as never);
    if (snap.exists && String(snap.data()?.departmentId ?? "") === deptId) releases.push(ref);
  }
  const staleOwners = new Map<string, boolean>();
  for (const c of checks) {
    if (!c.snap.exists) continue;
    const owner = String(c.snap.data()?.departmentId ?? "");
    if (owner === deptId) continue;
    if (!staleOwners.has(owner)) {
      const ownerSnap = owner ? await tx.get(departments.doc(owner) as never) : { exists: false, data: () => undefined };
      staleOwners.set(owner, !ownerSnap.exists);
    }
    if (!staleOwners.get(owner)) {
      throw new DepartmentKeyTakenError(
        c.field,
        c.field === "name" ? `A department named "${c.label}" already exists` : `Short code "${normalizeDepartmentCode(c.label)}" is already used by another department`
      );
    }
    // Lock whose owner no longer exists (deleted without releasing) - safe to take over.
  }

  // ---- writes ----
  for (const c of checks) {
    tx.set(c.ref as never, { departmentId: deptId, field: c.field, updatedAt: new Date() });
  }
  for (const ref of releases) tx.delete(ref as never);
}

/** Releases the locks a deleted department held. Call inside the delete's transaction/batch. */
export function releaseDepartmentKeys(
  writer: { delete(ref: never): unknown },
  keys: CollLike,
  held: KeyPair
): void {
  if (held.name) writer.delete(keys.doc(departmentKeyDocId("name", held.name)) as never);
  if (held.code) writer.delete(keys.doc(departmentKeyDocId("code", held.code)) as never);
}

/** Maps a thrown DepartmentKeyTakenError to a 409 body, or null when it isn't one. */
export function departmentKeyConflictMessage(err: unknown): string | null {
  if (!(err instanceof Error) || !err.message.startsWith(`${DEPARTMENT_KEY_TAKEN}:`)) return null;
  return err.message.split(":").slice(2).join(":");
}
