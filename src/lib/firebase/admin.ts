import type { App } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";

// In dev, HMR invalidates module-level vars but Firebase Admin
// persists across reloads via getApps(). Always re-attach from
// the existing app rather than caching in module scope.
function getAdminApp(): App {
  const { getApps, initializeApp, cert, getApp } = require("firebase-admin/app");

  if (getApps().length > 0) {
    return getApp() as App;
  }

  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  }) as App;
}

export function getAdminAuth(): Auth {
  const { getAuth } = require("firebase-admin/auth");
  return getAuth(getAdminApp()) as Auth;
}

export function getAdminDb(): Firestore {
  const { getFirestore } = require("firebase-admin/firestore");
  return getFirestore(getAdminApp()) as Firestore;
}

export function getAdminStorage(): Storage {
  const { getStorage } = require("firebase-admin/storage");
  return getStorage(getAdminApp()) as Storage;
}

// Lazy proxy accessors
export const adminAuth = new Proxy({} as Auth, {
  get(_target, prop) {
    return (getAdminAuth() as unknown as Record<string, unknown>)[prop as string];
  },
});

export const adminDb = new Proxy({} as Firestore, {
  get(_target, prop) {
    return (getAdminDb() as unknown as Record<string, unknown>)[prop as string];
  },
});

export const adminStorage = new Proxy({} as Storage, {
  get(_target, prop) {
    return (getAdminStorage() as unknown as Record<string, unknown>)[prop as string];
  },
});
