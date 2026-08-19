/**
 * One-time cleanup: deletes every `timetableIncharges` doc across all
 * colleges (HOD-assigned Timetable Incharge delegations - see
 * TimetableIncharge in src/types/core.ts). Requested to wipe out
 * assignments made before the sections/subjects/courses/departments API
 * fixes for PANEL_MEMBER/COLLEGE_STAFF Incharges, so testing starts clean.
 *
 * Doesn't touch anything the Incharge already did (teachingAssignments,
 * timetableSlots, timetableDrafts) - only the delegation record itself.
 *
 * Usage:
 *   node scripts/clear-timetable-incharges.mjs           # dry run - lists what would be deleted
 *   node scripts/clear-timetable-incharges.mjs --apply   # actually deletes
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const apply = process.argv.includes("--apply");

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
  const collegesSnap = await db.collection("colleges").get();
  let total = 0;

  for (const collegeDoc of collegesSnap.docs) {
    const inchargesSnap = await collegeDoc.ref.collection("timetableIncharges").get();
    if (inchargesSnap.empty) continue;

    console.log(`College ${collegeDoc.id} (${collegeDoc.data().name ?? "?"}): ${inchargesSnap.size} incharge(s)`);
    for (const doc of inchargesSnap.docs) {
      const d = doc.data();
      console.log(`  - ${doc.id}: ${d.facultyName ?? "?"} -> ${d.courseName ?? d.courseId} year ${d.year} (${d.departmentName ?? "?"})`);
    }
    total += inchargesSnap.size;

    if (apply) {
      const batch = db.batch();
      for (const doc of inchargesSnap.docs) batch.delete(doc.ref);
      await batch.commit();
      console.log(`  ✓ deleted`);
    }
  }

  if (total === 0) {
    console.log("No Timetable Incharge assignments found.");
  } else if (!apply) {
    console.log(`\n${total} assignment(s) found across all colleges. Re-run with --apply to delete them.`);
  } else {
    console.log(`\n✓ Deleted ${total} Timetable Incharge assignment(s).`);
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
