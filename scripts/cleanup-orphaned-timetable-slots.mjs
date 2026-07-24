/**
 * One-time cleanup: delete `timetableSlots` docs left behind by the old
 * "Current Assignments" delete button, which removed a `teachingAssignments`
 * doc without removing the timetableSlots that referenced it (fixed in
 * src/app/api/college/teaching-assignments/route.ts DELETE). Those orphaned
 * slots keep showing periods as "occupied" in the timetable grid even though
 * the assignment is gone.
 *
 * Scans every college's `timetableSlots` subcollection, checks whether each
 * slot's `assignmentId` still points to an existing `teachingAssignments`
 * doc, and deletes the ones that don't.
 *
 * Usage:
 *   node scripts/cleanup-orphaned-timetable-slots.mjs           # dry run — lists what would be deleted
 *   node scripts/cleanup-orphaned-timetable-slots.mjs --apply   # actually deletes
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
  let totalOrphaned = 0;

  for (const collegeDoc of collegesSnap.docs) {
    const collegeRef = collegeDoc.ref;
    const [slotsSnap, assignmentsSnap] = await Promise.all([
      collegeRef.collection("timetableSlots").get(),
      collegeRef.collection("teachingAssignments").get(),
    ]);

    const existingAssignmentIds = new Set(assignmentsSnap.docs.map((d) => d.id));
    const orphanedSlots = slotsSnap.docs.filter(
      (d) => !existingAssignmentIds.has(d.data().assignmentId)
    );

    if (orphanedSlots.length === 0) continue;

    console.log(`College ${collegeDoc.id} (${collegeDoc.data().name ?? "?"}): ${orphanedSlots.length} orphaned slot(s)`);
    for (const slot of orphanedSlots) {
      const s = slot.data();
      console.log(`  - ${slot.id}: section=${s.sectionId} subject=${s.subjectName ?? s.subjectId} ${s.day} period ${s.periodNumber} (dead assignmentId=${s.assignmentId})`);
    }
    totalOrphaned += orphanedSlots.length;

    if (apply) {
      for (let i = 0; i < orphanedSlots.length; i += 400) {
        const batch = db.batch();
        for (const slot of orphanedSlots.slice(i, i + 400)) batch.delete(slot.ref);
        await batch.commit();
      }
      console.log(`  ✓ deleted`);
    }
  }

  if (totalOrphaned === 0) {
    console.log("No orphaned timetable slots found.");
  } else if (!apply) {
    console.log(`\n${totalOrphaned} orphaned slot(s) found across all colleges. Re-run with --apply to delete them.`);
  } else {
    console.log(`\n✓ Deleted ${totalOrphaned} orphaned slot(s).`);
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
