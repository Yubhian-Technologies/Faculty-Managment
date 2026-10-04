import type { Firestore } from "firebase-admin/firestore";
import { createFirebaseUser } from "@/lib/firebase/authRest";

// Rollback-safe account provisioning.
//
// Creating a login is two systems: a Firebase Auth user, then Firestore documents
// (profile, role mapping, the person's own record). They can't share a
// transaction, so a failure after the Auth user exists used to leave an ORPHAN
// Auth user behind - which then blocked the same email ("already exists") on every
// retry. withAuthUser makes the pair behave as one unit:
//
//  - the Auth user is created first; if `work` (the Firestore writes) then throws,
//    an Auth user THIS call created is deleted again and the error is re-thrown;
//  - it is idempotent by email: if that email already has an Auth user that is a
//    genuine orphan from an older failed run - never signed in, no custom claims,
//    no systemUsers profile - it is reused (its password reset to the one given)
//    instead of failing; anything else means the email belongs to somebody and the
//    original "email already exists" error is thrown, so no account is ever hijacked;
//  - a reused orphan is NOT deleted if the work then fails (it was not ours).
//
// Callers should put every Firestore write that must go with the account into ONE
// `work` batch so those writes are all-or-nothing too.

export interface AuthUserLike {
  uid: string;
  customClaims?: Record<string, unknown> | null;
  metadata?: { lastSignInTime?: string | null };
}

export interface AuthAdminLike {
  getUserByEmail(email: string): Promise<AuthUserLike>;
  updateUser(uid: string, props: { password?: string; displayName?: string; disabled?: boolean }): Promise<unknown>;
  deleteUser(uid: string): Promise<void>;
}

export interface WithAuthUserOptions {
  email: string;
  password: string;
  displayName: string;
  db: Firestore;
  /** Test seams - production uses the REST creator and the Admin SDK. */
  createUser?: (email: string, password: string, displayName: string) => Promise<string>;
  getAdminAuth?: () => Promise<AuthAdminLike>;
}

function isEmailExists(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: string }).code === "auth/email-already-exists";
}

async function defaultAdminAuth(): Promise<AuthAdminLike> {
  const { getAdminAuth } = await import("@/lib/firebase/admin");
  return (await getAdminAuth()) as unknown as AuthAdminLike;
}

async function isReusableOrphan(db: Firestore, user: AuthUserLike): Promise<boolean> {
  if (user.metadata?.lastSignInTime) return false; // someone has used this account
  if (user.customClaims && Object.keys(user.customClaims).length > 0) return false;
  const profile = await db.collection("systemUsers").doc(user.uid).get();
  return !profile.exists;
}

export async function withAuthUser<T>(opts: WithAuthUserOptions, work: (uid: string) => Promise<T>): Promise<T> {
  const create = opts.createUser ?? createFirebaseUser;
  const adminAuth = opts.getAdminAuth ?? defaultAdminAuth;

  let uid: string;
  let createdHere = false;
  try {
    uid = await create(opts.email, opts.password, opts.displayName);
    createdHere = true;
  } catch (err) {
    if (!isEmailExists(err)) throw err;
    const auth = await adminAuth();
    const existing = await auth.getUserByEmail(opts.email);
    if (!(await isReusableOrphan(opts.db, existing))) throw err;
    await auth.updateUser(existing.uid, { password: opts.password, displayName: opts.displayName, disabled: false });
    uid = existing.uid;
  }

  try {
    return await work(uid);
  } catch (err) {
    if (createdHere) {
      try {
        await (await adminAuth()).deleteUser(uid);
      } catch (cleanupErr) {
        console.error("[withAuthUser] could not remove the Auth user after a failed write", uid, cleanupErr);
      }
    }
    throw err;
  }
}
