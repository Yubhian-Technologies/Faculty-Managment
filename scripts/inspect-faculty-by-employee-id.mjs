/**
 * Read-only: looks up facultyMembers docs (collection group, across every
 * college) by employeeId, and reports the linked login (users/systemUsers/
 * Auth) plus any teachingAssignments/timetableSlots that reference the doc -
 * the same references the app's own DELETE /api/college/faculty/[id] route
 * checks before allowing a hard delete. Run before any deletion so we know
 * exactly what's there and what would need to move first.
 *
 * Usage: node scripts/inspect-faculty-by-employee-id.mjs <employeeId> [employeeId...]
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

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
const auth = getAuth();

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error("Usage: node scripts/inspect-faculty-by-employee-id.mjs <employeeId> [employeeId...]");
  process.exit(1);
}

async function run() {
  console.log(`Firebase project: ${process.env.FIREBASE_ADMIN_PROJECT_ID}\n`);
  for (const empId of ids) {
    console.log(`===== ${empId} =====`);
    const snap = await db.collectionGroup("facultyMembers").where("employeeId", "==", empId).get();
    if (snap.empty) {
      console.log("  (no facultyMembers doc with this employeeId)\n");
      continue;
    }
    for (const doc of snap.docs) {
      const d = doc.data();
      const collegeRef = doc.ref.parent.parent; // colleges/{collegeId}
      console.log(`  doc: ${doc.ref.path}`);
      console.log(`  collegeId: ${collegeRef?.id}`);
      console.log(`  legalName: ${d.legalName ?? "(none)"}`);
      console.log(`  department: ${d.department ?? "(none)"}`);
      console.log(`  status: ${d.status ?? "(none)"}`);
      console.log(`  collegeEmail: ${d.collegeEmail ?? "(none)"}`);
      console.log(`  userUid: ${d.userUid ?? "(none)"}`);

      if (d.userUid && collegeRef) {
        const userSnap = await collegeRef.collection("users").doc(d.userUid).get();
        console.log(`  users/${d.userUid}: ${userSnap.exists ? "exists" : "MISSING"}`);
        const sysUserSnap = await db.collection("systemUsers").doc(d.userUid).get();
        console.log(`  systemUsers/${d.userUid}: ${sysUserSnap.exists ? "exists" : "MISSING"}`);
        try {
          await auth.getUser(d.userUid);
          console.log(`  Firebase Auth account: exists`);
        } catch {
          console.log(`  Firebase Auth account: MISSING`);
        }
      }

      if (collegeRef) {
        const [assignSnap, slotSnap] = await Promise.all([
          collegeRef.collection("teachingAssignments").where("facultyId", "==", doc.id).get(),
          collegeRef.collection("timetableSlots").where("facultyId", "==", doc.id).get(),
        ]);
        console.log(`  teachingAssignments referencing this doc: ${assignSnap.size}`);
        console.log(`  timetableSlots referencing this doc: ${slotSnap.size}`);
      }
      console.log("");
    }
  }
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
