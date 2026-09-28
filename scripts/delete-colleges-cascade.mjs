/**
 * DESTRUCTIVE. For each given collegeId: deletes every Firebase Auth account
 * for its colleges/{id}/users docs, then recursively deletes the college doc
 * and every subcollection beneath it (arbitrary depth). No undo.
 *
 * Usage: node scripts/delete-colleges-cascade.mjs <collegeId> [collegeId...]
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

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
const auth = getAuth();

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error("Usage: node scripts/delete-colleges-cascade.mjs <collegeId> [collegeId...]");
  process.exit(1);
}

async function run() {
  for (const id of ids) {
    console.log(`\n===== ${id} =====`);
    const ref = db.collection("colleges").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log("  (no college doc with this id - skipping)");
      continue;
    }
    console.log(`  name: ${snap.data().name ?? "(none)"}`);

    const usersSnap = await ref.collection("users").get();
    console.log(`  deleting ${usersSnap.size} Auth account(s)...`);
    for (const u of usersSnap.docs) {
      try {
        await auth.deleteUser(u.id);
        console.log(`    - deleted Auth user ${u.id} (${u.data().email ?? "no email"})`);
      } catch (err) {
        console.log(`    - Auth user ${u.id} (${u.data().email ?? "no email"}): ${err.message}`);
      }
    }

    console.log("  recursively deleting Firestore doc + subcollections...");
    await db.recursiveDelete(ref);
    console.log(`  done: ${id}`);
  }
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
