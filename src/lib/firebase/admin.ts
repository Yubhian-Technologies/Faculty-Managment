import { getApps, initializeApp, cert, getApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";

// firebase-admin/auth is loaded lazily via dynamic import below.
// Static import would cause ERR_REQUIRE_ESM at module load time because
// jwks-rsa (used by verifyIdToken) requires jose v6 (ESM-only).
// createUser / setCustomUserClaims / updateUser do NOT touch jwks-rsa.

function getAdminApp(): App {
  if (getApps().length > 0) return getApp();

  const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
  const privateKey = rawKey.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");

  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey,
    }),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });
}

export async function getAdminAuth() {
  const { getAuth } = await import("firebase-admin/auth");
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}

export function getAdminStorage(): Storage {
  return getStorage(getAdminApp());
}

export const adminDb: Firestore = new Proxy({} as Firestore, {
  get(_target, prop) {
    const instance = getAdminDb();
    const val = (instance as unknown as Record<string, unknown>)[prop as string];
    return typeof val === "function" ? (val as (...a: unknown[]) => unknown).bind(instance) : val;
  },
});

export const adminStorage: Storage = new Proxy({} as Storage, {
  get(_target, prop) {
    const instance = getAdminStorage();
    const val = (instance as unknown as Record<string, unknown>)[prop as string];
    return typeof val === "function" ? (val as (...a: unknown[]) => unknown).bind(instance) : val;
  },
});
