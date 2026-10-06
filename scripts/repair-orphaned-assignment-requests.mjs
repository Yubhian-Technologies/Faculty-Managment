/**
 * One-time repair: faculty-assignment requests that are ALLOCATED but whose
 * teachingAssignmentId no longer exists in teachingAssignments.
 *
 * Happens when the allocated assignment was deleted (e.g. from the Teaching
 * Assignments page) - the request kept saying "Allocated", the requester got
 * no subject in the timetable's "Add a subject", and the lender couldn't
 * allocate again (only PENDING requests can be acted on). The delete flow now
 * reopens the request itself; this fixes the ones already stuck.
 *
 * Each orphan is reset to PENDING (allocation + busy-period fields cleared),
 * so the lending department sees it in "Requests to us" again. A request is
 * LEFT ALONE when a live (non-past) assignment already exists for the same
 * section + subject, and listed so you can decide by hand.
 *
 * Dry run by default - nothing is written unless you pass --apply.
 *
 * Usage:
 *   node scripts/repair-orphaned-assignment-requests.mjs <collegeId>          # report only
 *   node scripts/repair-orphaned-assignment-requests.mjs <collegeId> --apply  # write
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

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
const collegeId = process.argv[2];
const apply = process.argv.includes("--apply");
if (!collegeId) {
  console.error("Usage: node scripts/repair-orphaned-assignment-requests.mjs <collegeId> [--apply]");
  process.exit(1);
}

async function run() {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const reqSnap = await collegeRef.collection("facultyAssignmentRequests").where("status", "==", "ALLOCATED").get();
  console.log(`ALLOCATED requests: ${reqSnap.size}  (${apply ? "APPLY" : "dry run"})`);

  let orphaned = 0, repaired = 0, skipped = 0;
  for (const d of reqSnap.docs) {
    const r = d.data();
    const label = `${d.id}  ${r.subjectCode ?? ""} ${r.subjectName ?? ""} / ${r.sectionName ?? ""}  -> ${r.allocatedFacultyName ?? "?"}  (asked by ${r.requestedByName ?? "?"}, to ${r.targetDepartmentName ?? "?"})`;
    const taId = r.teachingAssignmentId;
    const exists = taId ? (await collegeRef.collection("teachingAssignments").doc(taId).get()).exists : false;
    if (exists) continue;
    orphaned++;

    const sameSnap = await collegeRef.collection("teachingAssignments")
      .where("sectionId", "==", r.sectionId).where("subjectId", "==", r.subjectId).get();
    const live = sameSnap.docs.find((x) => !x.data().isPast);
    if (live) {
      skipped++;
      console.log(`SKIP   ${label}\n       assignment ${taId ?? "(none)"} is gone, but ${live.id} (${live.data().facultyName}) now covers this section+subject - check by hand`);
      continue;
    }

    console.log(`ORPHAN ${label}\n       missing teachingAssignmentId: ${taId ?? "(none)"}`);
    if (apply) {
      await d.ref.update({
        status: "PENDING",
        allocatedFacultyId: FieldValue.delete(),
        allocatedFacultyName: FieldValue.delete(),
        allocatedBy: FieldValue.delete(),
        teachingAssignmentId: FieldValue.delete(),
        busyPeriods: FieldValue.delete(),
        busyClosed: FieldValue.delete(),
        busyClosedAt: FieldValue.delete(),
        updatedAt: new Date(),
      });
      repaired++;
    }
  }

  console.log(`\norphaned: ${orphaned}  skipped (needs a look): ${skipped}  reset to PENDING: ${repaired}`);
  if (!apply && orphaned - skipped > 0) console.log("Dry run only - re-run with --apply to reset them.");
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
