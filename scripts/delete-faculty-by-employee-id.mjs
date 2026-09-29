/**
 * Permanently deletes specific facultyMembers docs (found by employeeId) and
 * everything the app's own DELETE /api/college/faculty/[id] route cascades
 * to: the linked colleges/{id}/users doc, systemUsers doc, and Firebase Auth
 * account. Also clears departments.hodUid/hodName wherever it pointed at the
 * deleted account, so the department doesn't keep a dangling reference.
 *
 * This is a one-off targeted counterpart to the app route (which only
 * accepts a Firestore doc id, not an employeeId, and refuses to run outside
 * a real HOD/Principal session) - confirmed with the user before running,
 * since both target records were active HOD logins for real departments.
 *
 * Usage: node scripts/delete-faculty-by-employee-id.mjs <employeeId> [employeeId...]
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
  console.error("Usage: node scripts/delete-faculty-by-employee-id.mjs <employeeId> [employeeId...]");
  process.exit(1);
}

async function run() {
  for (const empId of ids) {
    console.log(`===== ${empId} =====`);
    const snap = await db.collectionGroup("facultyMembers").where("employeeId", "==", empId).get();
    if (snap.empty) {
      console.log("  (no facultyMembers doc with this employeeId - nothing to delete)\n");
      continue;
    }
    for (const doc of snap.docs) {
      const d = doc.data();
      const collegeRef = doc.ref.parent.parent;
      console.log(`  Deleting ${doc.ref.path} (${d.legalName ?? "?"})`);
      await doc.ref.delete();

      if (d.userUid && collegeRef) {
        await collegeRef.collection("users").doc(d.userUid).delete();
        console.log(`  Deleted users/${d.userUid}`);
        await db.collection("systemUsers").doc(d.userUid).delete();
        console.log(`  Deleted systemUsers/${d.userUid}`);
        try {
          await auth.deleteUser(d.userUid);
          console.log(`  Deleted Firebase Auth account ${d.userUid}`);
        } catch (err) {
          console.log(`  Firebase Auth account ${d.userUid}: ${err.code ?? err.message}`);
        }

        if (collegeRef) {
          const deptSnap = await collegeRef.collection("departments").where("hodUid", "==", d.userUid).get();
          for (const deptDoc of deptSnap.docs) {
            await deptDoc.ref.update({ hodUid: "", hodName: "" });
            console.log(`  Cleared hodUid/hodName on department "${deptDoc.data().name}"`);
          }
        }
      }
      console.log("");
    }
  }
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
