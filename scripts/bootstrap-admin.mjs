/**
 * One-time script: promote a Firebase Auth user to SUPER_ADMIN.
 *
 * Steps:
 *   1. Go to Firebase Console → Authentication → Add user
 *   2. Paste the UID + email below
 *   3. node scripts/bootstrap-admin.mjs
 */

import { readFileSync } from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// ── Edit these two lines ──────────────────────────────────────────────────────
const UID   = "RTE4YqtzPVMuXTsRWgRhrHbKkn23";
const EMAIL = "yubhiantechnologies@gmail.com";
// ─────────────────────────────────────────────────────────────────────────────

const serviceAccount = JSON.parse(
  readFileSync(
    "/Users/rishi/Downloads/faculty-management-37e84-firebase-adminsdk-fbsvc-9001715fc7.json",
    "utf8"
  )
);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const authAdmin = getAuth();

async function run() {
  await authAdmin.setCustomUserClaims(UID, { role: "SUPER_ADMIN", collegeId: "" });
  console.log(`✓ ${EMAIL} is now SUPER_ADMIN`);
  console.log(`  Log in at http://localhost:3002/login`);
  console.log(`  Redirect will go to /super-admin`);
}

run().catch((err) => { console.error(err); process.exit(1); });
