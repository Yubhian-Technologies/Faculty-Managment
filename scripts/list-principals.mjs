/**
 * Read-only: list all PRINCIPAL/VICE_PRINCIPAL accounts from systemUsers.
 * Usage: node --experimental-require-module scripts/list-principals.mjs
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const db = getFirestore();

async function run() {
  const snap = await db
    .collection("systemUsers")
    .where("role", "in", ["PRINCIPAL", "VICE_PRINCIPAL"])
    .get();

  if (snap.empty) {
    console.log("No PRINCIPAL/VICE_PRINCIPAL accounts found in systemUsers.");
    return;
  }

  for (const doc of snap.docs) {
    const d = doc.data();
    console.log(`- ${d.name ?? "(no name)"} <${d.email}> role=${d.role} collegeId=${d.collegeId} uid=${doc.id}`);
  }
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
