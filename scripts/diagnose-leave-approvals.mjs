/**
 * Read-only diagnostic: for every college, print every leaveRequest whose
 * requester role is one of the "non-departmental" roles (Dean, R&D, T&P,
 * IQAC, Vice Principal, College Office, Accounts, Finance, Library, Exam
 * Cell, Webmaster, Placement Dept, Purchase Dept) - status, department field
 * (should be absent), and requester uid/role - to explain why a submitted
 * request isn't showing up on the Principal's Leave Approvals page. Reads
 * only - writes nothing.
 *
 * Usage: node scripts/diagnose-leave-approvals.mjs
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

const NON_DEPT_ROLES = new Set([
  "VICE_PRINCIPAL", "COLLEGE_OFFICE", "COLLEGE_STAFF", "DEAN",
  "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "LIBRARY", "EXAM_CELL",
  "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT",
]);

async function run() {
  const collegesSnap = await db.collection("colleges").get();

  for (const collegeDoc of collegesSnap.docs) {
    const collegeRef = collegeDoc.ref;
    const requestsSnap = await collegeRef.collection("leaveRequests").get();
    if (requestsSnap.empty) continue;

    console.log(`\n=== College ${collegeDoc.id} (${collegeDoc.data().name ?? "?"}) - ${requestsSnap.size} leave request(s) ===`);

    for (const reqDoc of requestsSnap.docs) {
      const r = reqDoc.data();
      const userSnap = await collegeRef.collection("users").doc(r.uid).get();
      const role = userSnap.exists ? userSnap.data().role : "(no users/ doc)";
      const flag = NON_DEPT_ROLES.has(role) ? " <-- non-departmental" : "";
      console.log(
        `  [${reqDoc.id}] uid=${r.uid} role=${role}${flag} employeeName="${r.employeeName}" ` +
        `status=${r.status} department=${JSON.stringify(r.department ?? null)} ` +
        `leaveTypeCode=${r.leaveTypeCode ?? "-"} isOtherRequest=${!!r.isOtherRequest} ` +
        `createdAt=${r.createdAt?.toDate?.()?.toISOString?.() ?? r.createdAt}`
      );
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
