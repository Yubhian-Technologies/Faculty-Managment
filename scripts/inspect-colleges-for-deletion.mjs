/**
 * Read-only: for each given collegeId, report the college's own doc fields,
 * every subcollection under colleges/{id} with a document count, and whether
 * each doc in colleges/{id}/users has a matching Firebase Auth account.
 * Run before any deletion so we know exactly what we'd be removing.
 *
 * Usage: node scripts/inspect-colleges-for-deletion.mjs <collegeId> [collegeId...]
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
  console.error("Usage: node scripts/inspect-colleges-for-deletion.mjs <collegeId> [collegeId...]");
  process.exit(1);
}

async function run() {
  for (const id of ids) {
    console.log(`\n===== ${id} =====`);
    const ref = db.collection("colleges").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log("  (no college doc with this id)");
      continue;
    }
    const d = snap.data();
    console.log(`  name: ${d.name ?? "(none)"}`);
    console.log(`  locationId: ${d.locationId ?? "(none)"}`);
    console.log(`  type: ${d.type ?? "(none)"}`);
    console.log(`  isActive: ${d.isActive}`);

    const collections = await ref.listCollections();
    if (collections.length === 0) {
      console.log("  subcollections: (none)");
    } else {
      console.log("  subcollections:");
      for (const col of collections) {
        const countSnap = await col.count().get();
        console.log(`    - ${col.id}: ${countSnap.data().count} docs`);
      }
    }

    const usersCol = collections.find((c) => c.id === "users");
    if (usersCol) {
      const usersSnap = await usersCol.get();
      console.log(`  users (${usersSnap.size}):`);
      for (const u of usersSnap.docs) {
        const ud = u.data();
        let authStatus = "no matching Auth account";
        try {
          await auth.getUser(u.id);
          authStatus = "Auth account exists";
        } catch {
          // no matching auth user
        }
        console.log(`    - ${u.id} | ${ud.name ?? "(no name)"} <${ud.email ?? "no email"}> role=${ud.role ?? "?"} | ${authStatus}`);
      }
    }
  }
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
