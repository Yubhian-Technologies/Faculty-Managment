/**
 * One-time fix: sets campusLocation for the Hyderabad-area colleges that
 * were missing it entirely (see diagnose-campus-locations.mjs) - urgent
 * because the Super Admin who'd otherwise configure this sits in
 * Bhimavaram, while the faculty needing to check in are physically in
 * Hyderabad. Unlike the Bhimavaram campus (which had a hand-drawn polygon
 * to reuse), no polygon exists for these, so each is a circle centered on
 * an OpenStreetMap building-level pin, radius sized for a real campus
 * footprint:
 *   - ORCHARD PARK CAMPUS (Narsapur, Medak): B V Raju Institute of
 *     Technology's own OSM pin (17.7250378, 78.2547338). Vishnu Institute
 *     of Pharmaceutical Education and Research (VIPER) shares this same
 *     campus per two independent sources, so reuses the same circle.
 *   - VALLEY VISTA CAMPUS (Nizampet Road, Bachupally): BVRIT College of
 *     Engineering for Women's own OSM pin (17.5263756, 78.3699064) - a
 *     separate, distinct campus from Narsapur.
 *
 * Usage: node scripts/fix-hyderabad-campus-locations.mjs
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

const FIXES = [
  {
    id: "32f1db02adc84b258a22", // B V RAJU INSTITUTE OF TECHNOLOGY
    campusLocation: { shape: "circle", latitude: 17.7250378, longitude: 78.2547338, radiusMeters: 600 },
  },
  {
    id: "fb503be6efe4417f8a32", // VISHNU INSTITUTE OF PHARMACEUTICAL EDUCATION AND RESEARCH
    campusLocation: { shape: "circle", latitude: 17.7250378, longitude: 78.2547338, radiusMeters: 600 },
  },
  {
    id: "fbf94c553f2940828adf", // BVRIT COLLEGE OF ENGINEERING FOR WOMEN
    campusLocation: { shape: "circle", latitude: 17.5263756, longitude: 78.3699064, radiusMeters: 400 },
  },
];

async function run() {
  for (const { id, campusLocation } of FIXES) {
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
    await ref.update({ campusLocation, updatedAt: new Date() });
    console.log(`[${college.name}] campusLocation set (circle, ${campusLocation.radiusMeters}m radius)`);
  }
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
