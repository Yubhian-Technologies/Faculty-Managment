/**
 * One-time fix: sets campusLocation for VISHNU EDUCATIONAL DEVELOPMENT AND
 * INNOVATION CENTER (LAKE VIEWS CAMPUS), which was missing it entirely (see
 * diagnose-campus-locations.mjs). LOWER CONFIDENCE than the other campus
 * fixes: no exact building-level pin was found - the institution's own site
 * (srivishnu.edu.in/lake-view) lists it at "Nagarjuna Hills, Punjagutta
 * Main Road, Hyderabad", which only resolves to the general
 * Punjagutta/Nagarjuna Hills neighborhood on OpenStreetMap
 * (17.4237226, 78.4483379), not a specific building. Radius widened to
 * 800m to compensate for that imprecision - Super Admin should replace
 * this with "Use Current Location" from on-site when convenient.
 *
 * Usage: node scripts/fix-lakeviews-campus-location.mjs
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

const id = "831facfffb944f709ff1"; // VISHNU EDUCATIONAL DEVELOPMENT AND INNOVATION CENTER
const campusLocation = { shape: "circle", latitude: 17.4237226, longitude: 78.4483379, radiusMeters: 800 };

async function run() {
  const ref = db.collection("colleges").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`[${id}] SKIPPED - college not found`);
    return;
  }
  const college = snap.data();
  if (college.campusLocation) {
    console.log(`[${college.name}] SKIPPED - already has a campusLocation set`);
    return;
  }
  await ref.update({ campusLocation, updatedAt: new Date() });
  console.log(`[${college.name}] campusLocation set (circle, ${campusLocation.radiusMeters}m radius) - LOWER CONFIDENCE, verify when possible`);
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
