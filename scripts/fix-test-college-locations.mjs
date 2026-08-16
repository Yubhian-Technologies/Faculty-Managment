/**
 * Sets campusLocation on the remaining GREEN MEADOWS-TEST colleges that were
 * still MISSING it (see diagnose-campus-locations.mjs) - these are test/demo
 * entries with no real physical campus, but are actively used to test the
 * app (e.g. TEST COLLEGE / TEST PRINCIPAL). Reuses the exact same Bhimavaram
 * campus polygon two siblings in this same test bucket (DEMO COLLEGE,
 * Vishnu Women's University) already had, for consistency.
 *
 * Usage: node scripts/fix-test-college-locations.mjs
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
const privateKey = rawKey.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

const db = getFirestore();

const BHIMAVARAM_CAMPUS_POLYGON = {
  shape: "polygon",
  points: [
    { latitude: 16.5643233, longitude: 81.5207096 },
    { latitude: 16.5651378, longitude: 81.5229308 },
    { latitude: 16.5654343, longitude: 81.5232277 },
    { latitude: 16.5683158, longitude: 81.525606 },
    { latitude: 16.5692643, longitude: 81.5259179 },
    { latitude: 16.5695554, longitude: 81.5249542 },
    { latitude: 16.5702202, longitude: 81.5210573 },
    { latitude: 16.5697913, longitude: 81.5208234 },
    { latitude: 16.5691575, longitude: 81.5205008 },
    { latitude: 16.5661908, longitude: 81.5193654 },
    { latitude: 16.5656338, longitude: 81.5192018 },
    { latitude: 16.5654598, longitude: 81.5191606 },
    { latitude: 16.5641998, longitude: 81.5192038 },
  ],
};

const COLLEGE_IDS = [
  "fde13860bbb246da9daa", // CHAITANYA COLLEGE
  "c71ebb555cfc435eb4ad", // TEST COLLEGE
  "3c5250fcd63743ad9d56", // test degree
  "d028181767a141a98d1e", // Test Dental
  "427e5d066e5349a7ba88", // Test Engineering
  "2a25dedf65454a57abe1", // Test Pharmacy
  "5e5c23144d7f45d5ae3a", // Test Polytechnic
  "4628f4fedeef4f2d8749", // Test School
];

async function run() {
  for (const id of COLLEGE_IDS) {
    const ref = db.collection("colleges").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`[${id}] SKIPPED - college not found`);
      continue;
    }
    const college = snap.data();
    if (college.campusLocation) {
      console.log(`[${college.name}] SKIPPED - already has a campusLocation set`);
      continue;
    }
    await ref.update({ campusLocation: BHIMAVARAM_CAMPUS_POLYGON, updatedAt: new Date() });
    console.log(`[${college.name}] campusLocation set to the Bhimavaram campus polygon`);
  }
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
