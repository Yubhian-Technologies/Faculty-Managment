/**
 * One-time script: create a Firebase Auth user and promote it to SUPER_ADMIN.
 * Reads Admin SDK credentials from .env (FIREBASE_ADMIN_*).
 *
 * Usage: node scripts/create-admin.mjs <email> <password> [displayName]
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const [, , EMAIL, PASSWORD, DISPLAY_NAME] = process.argv;

if (!EMAIL || !PASSWORD) {
  console.error("Usage: node scripts/create-admin.mjs <email> <password> [displayName]");
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const authAdmin = getAuth();
const db = getFirestore();

async function run() {
  let uid;
  try {
    const user = await authAdmin.createUser({
      email: EMAIL,
      password: PASSWORD,
      displayName: DISPLAY_NAME || EMAIL,
    });
    uid = user.uid;
    console.log(`✓ Created Firebase Auth user ${EMAIL} (${uid})`);
  } catch (err) {
    if (err.code === "auth/email-already-exists") {
      const user = await authAdmin.getUserByEmail(EMAIL);
      uid = user.uid;
      console.log(`… User already exists, reusing ${EMAIL} (${uid})`);
    } else {
      throw err;
    }
  }

  await authAdmin.setCustomUserClaims(uid, { role: "SUPER_ADMIN", collegeId: "" });

  await db.collection("systemUsers").doc(uid).set({
    uid,
    role: "SUPER_ADMIN",
    collegeId: "",
    locationId: "",
    email: EMAIL,
    name: DISPLAY_NAME || EMAIL,
  });

  console.log(`✓ ${EMAIL} is now SUPER_ADMIN`);
  console.log(`  Log in at http://localhost:3000/login`);
  console.log(`  Redirect will go to /super-admin`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
