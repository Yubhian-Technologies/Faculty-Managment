/**
 * Targeted fix: clear the accidental `managedDepartments` on the Basic Science
 * sub-departments (BS-MATHS, BS-ENGLISH) of the "Test Engineering" college.
 * They were set to [CSE, ECE], which made the Basic Science HOD inherit full/
 * editable access to the CSE and ECE departments (all their sections showed up
 * under Basic Science). The intended shared-first-year link is Basic Science's
 * `secondaryDepartments` (view-only cross-listing), which is left untouched.
 *
 * Prints each old value before writing so the change is reversible. Only touches
 * sub-departments that (a) belong to the named college, (b) are children of a
 * "Basic Science" parent, and (c) actually have a non-empty managedDepartments.
 *
 * Usage: node scripts/fix-department-managed-leak.mjs           (dry run - prints only)
 *        node scripts/fix-department-managed-leak.mjs --apply   (writes the change)
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const COLLEGE_NAME = "Test Engineering";

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
  const college = collegesSnap.docs.find(
    (d) => (d.data().name ?? "").trim().toLowerCase() === COLLEGE_NAME.toLowerCase()
  );
  if (!college) {
    console.error(`College "${COLLEGE_NAME}" not found.`);
    process.exit(1);
  }

  const deptsSnap = await college.ref.collection("departments").get();
  const basicScienceIds = new Set(
    deptsSnap.docs
      .filter((d) => (d.data().name ?? "").trim().toLowerCase() === "basic science")
      .map((d) => d.id)
  );

  const targets = deptsSnap.docs.filter((d) => {
    const x = d.data();
    return (
      x.parentDepartmentId &&
      basicScienceIds.has(x.parentDepartmentId) &&
      Array.isArray(x.managedDepartments) &&
      x.managedDepartments.length > 0
    );
  });

  if (targets.length === 0) {
    console.log("Nothing to fix - no Basic Science sub-department has managedDepartments set.");
    process.exit(0);
  }

  console.log(`College ${college.id} (${college.data().name})`);
  console.log(`${APPLY ? "APPLYING" : "DRY RUN (pass --apply to write)"} - ${targets.length} sub-department(s):`);
  for (const d of targets) {
    const old = d.data().managedDepartments;
    console.log(`  ${d.data().name}: managedDepartments was [${old.join(", ")}] -> removed`);
    if (APPLY) {
      await d.ref.update({ managedDepartments: FieldValue.delete(), updatedAt: new Date() });
    }
  }

  console.log(APPLY ? "\nDone - change written." : "\nDry run only - no changes written.");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
