import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, getFirestore, type Firestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "placeholder",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "placeholder.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "placeholder",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "placeholder.appspot.com",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "000000000000",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:000000000000:web:placeholder",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const isExistingApp = getApps().length > 0;
const app = isExistingApp ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Auto-detect long-polling: Firestore's default streaming (WebChannel)
// transport gets silently blocked by some corporate proxies, firewalls, VPNs
// and antivirus, surfacing as "[code=unavailable] Could not reach Cloud
// Firestore backend". Letting the SDK detect that and fall back to long-polling
// keeps the connection alive in those environments. initializeFirestore must
// run exactly once per app, so on HMR/re-import (app already created) reuse the
// existing instance instead of re-initializing.
export const db: Firestore = isExistingApp
  ? getFirestore(app)
  : initializeFirestore(app, { experimentalAutoDetectLongPolling: true });

export const storage = getStorage(app);

// Analytics is browser-only - lazy load to avoid SSR errors
export async function getAnalyticsInstance() {
  if (typeof window === "undefined") return null;
  const { getAnalytics, isSupported } = await import("firebase/analytics");
  const supported = await isSupported();
  if (!supported) return null;
  return getAnalytics(app);
}

export default app;
