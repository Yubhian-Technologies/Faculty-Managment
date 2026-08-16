/**
 * One-time fix: applies the real Bhimavaram (Vishnupur) campus boundary -
 * the exact 13-point polygon already sitting unused on the "DEMO COLLEGE"
 * and "Vishnu Women's University" test records - onto the 7 real colleges
 * co-located on that same physical campus (GREEN MEADOWS location), which
 * were all missing campusLocation entirely (see
 * diagnose-campus-locations.mjs). The polygon's accuracy was cross-checked
 * against independent OpenStreetMap coordinates for Vishnu Institute of
 * Technology (16.5659606, 81.5225313) and Vishnu Dental College block 2
 * (16.5682542, 81.5208920) - both fall inside it.
 *
 * Usage: node scripts/fix-bhimavaram-campus-location.mjs
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
  "dbccc2d56c58442f85dd", // B V R COLLEGE DEGREE AND PG
  "8374a43e58db4a2080cf", // SHRI VISHNU COLLEGE OF PHARMACY
  "6df56a45a69244238ca0", // SHRI VISHNU ENGINEERING COLLEGE FOR WOMEN
  "3293b694f9fe4b16a7ea", // Smt.B.SEETHA POLYTECHNIC COLLEGE
  "13a2c22e6680411ea4c8", // VISHNU DENTAL COLLEGE
  "bc77d03b57194edeb006", // VISHNU INSTITUTE OF TECHNOLOGY
  "3be86adbde1c4b6ca933", // VISHNU SCHOOL
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
