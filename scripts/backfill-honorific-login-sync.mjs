/**
 * One-time backfill: for every facultyMembers record that has an honorific
 * set AND a linked login (userUid), recompute the honorific-prefixed display
 * name (same formatting as src/lib/faculty/facultyDisplayName.ts) and push it
 * onto the linked colleges/{id}/users and systemUsers docs, plus any
 * roleSeats doc where that uid is the current holder (holderName).
 *
 * Needed because the faculty create/edit routes previously synced the login
 * doc's `name` from plain legalName only, never honorific - so adding/
 * changing an Honorific on an existing faculty member never reached their
 * login, and everything downstream that reads a cached name snapshot
 * (roleSeats.holderName, departments.hodName, every "HOD: ..." card) stayed
 * stale even after the display-name fix itself landed. That route bug is now
 * fixed for all FUTURE saves; this script corrects the already-stale data
 * left over from before the fix. departments.hodName itself doesn't need a
 * direct write here - GET /api/college/departments already self-heals it
 * from roleSeats.holderName on every load.
 *
 * Usage: node scripts/backfill-honorific-login-sync.mjs <collegeId>
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

// Mirrors src/lib/faculty/facultyDisplayName.ts exactly.
function facultyDisplayName(f) {
  const name = (f?.legalName ?? "").trim();
  if (!name) return "";
  const honorific = (f?.honorific ?? "").trim().replace(/\.+$/, "");
  return honorific ? `${honorific}.${name}` : name;
}

const collegeId = process.argv[2];
if (!collegeId) {
  console.error("Usage: node scripts/backfill-honorific-login-sync.mjs <collegeId>");
  process.exit(1);
}

async function run() {
  const collegeRef = db.collection("colleges").doc(collegeId);
  // Filtered in JS, not via a Firestore `!=` query, to avoid any composite-
  // index surprises - this college's whole facultyMembers collection is a
  // few hundred docs at most, cheap to scan client-side.
  const facSnap = await collegeRef.collection("facultyMembers").get();
  const withHonorific = facSnap.docs.filter((doc) => (doc.data().honorific ?? "").trim());

  console.log(`facultyMembers with a non-empty honorific: ${withHonorific.length} (of ${facSnap.size} total)`);

  const correctNameByUid = new Map(); // uid -> correct display name, for the roleSeats pass below
  let usersFixed = 0;

  for (const doc of withHonorific) {
    const d = doc.data();
    if (!d.userUid) continue;
    const correct = facultyDisplayName(d);
    if (!correct) continue;
    correctNameByUid.set(d.userUid, correct);

    const userRef = collegeRef.collection("users").doc(d.userUid);
    const sysUserRef = db.collection("systemUsers").doc(d.userUid);
    const [userSnap, sysSnap] = await Promise.all([userRef.get(), sysUserRef.get()]);
    const userName = userSnap.exists ? userSnap.data().name : undefined;
    const sysName = sysSnap.exists ? sysSnap.data().name : undefined;

    if (userSnap.exists && userName !== correct) {
      await userRef.update({ name: correct });
      console.log(`  users/${d.userUid}: "${userName}" -> "${correct}"`);
      usersFixed++;
    }
    if (sysSnap.exists && sysName !== correct) {
      await sysUserRef.update({ name: correct });
      console.log(`  systemUsers/${d.userUid}: "${sysName}" -> "${correct}"`);
    }
  }

  // roleSeats.holderName - any seat (HOD or otherwise) currently held by one
  // of these corrected uids. GET /api/college/departments will then self-heal
  // departments.hodName from this the next time it's loaded.
  const seatsSnap = await collegeRef.collection("roleSeats").get();
  let seatsFixed = 0;
  for (const doc of seatsSnap.docs) {
    const s = doc.data();
    if (!s.holderUid || !correctNameByUid.has(s.holderUid)) continue;
    const correct = correctNameByUid.get(s.holderUid);
    if (s.holderName !== correct) {
      await doc.ref.update({ holderName: correct });
      console.log(`  roleSeats/${doc.id} (${s.label ?? s.role}): "${s.holderName}" -> "${correct}"`);
      seatsFixed++;
    }
  }

  console.log(`\nDone. users/systemUsers docs fixed: ${usersFixed}, roleSeats docs fixed: ${seatsFixed}`);
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
