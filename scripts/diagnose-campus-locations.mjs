/**
 * Read-only diagnostic: lists every college and whether campusLocation
 * (the self-attendance check-in/out geofence) is configured, and its shape
 * if so. Used to find which colleges are missing this before self-attendance
 * check-in can work there - see /api/college/attendance/check-in and
 * src/lib/attendance/geofence.ts. Reads only - writes nothing.
 *
 * Usage: node scripts/diagnose-campus-locations.mjs
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

async function run() {
  const [collegesSnap, locationsSnap] = await Promise.all([
    db.collection("colleges").get(),
    db.collection("locations").get(),
  ]);

  const locationNames = new Map(locationsSnap.docs.map((d) => [d.id, d.data().name ?? d.id]));

  const rows = collegesSnap.docs.map((doc) => {
    const c = doc.data();
    const loc = locationNames.get(c.locationId) ?? c.locationId ?? "-";
    let status;
    if (!c.campusLocation) {
      status = "MISSING";
    } else if (c.campusLocation.shape === "circle") {
      status = `circle (${c.campusLocation.latitude}, ${c.campusLocation.longitude}, ${c.campusLocation.radiusMeters}m)`;
    } else {
      status = `polygon (${c.campusLocation.points?.length ?? 0} points)`;
    }
    return { id: doc.id, name: c.name ?? "-", location: loc, status };
  });

  rows.sort((a, b) => a.location.localeCompare(b.location) || a.name.localeCompare(b.name));

  console.log(`${rows.length} college(s):\n`);
  for (const r of rows) {
    console.log(`[${r.location}] ${r.name}  (${r.id})  ->  ${r.status}`);
  }

  const missing = rows.filter((r) => r.status === "MISSING");
  console.log(`\n${missing.length} college(s) missing campusLocation.`);
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
