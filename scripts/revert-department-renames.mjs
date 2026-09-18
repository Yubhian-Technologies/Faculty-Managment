/**
 * Revert a specific set of department renames that never cascaded.
 *
 * Renaming a department via PATCH /api/college/departments only updates the
 * department doc's own `name` field - it does not cascade into sections,
 * other departments' secondaryDepartments/managedDepartments, or the
 * assigned HOD's users.department/departments[]. See
 * scripts/diagnose-department-rename-revert.mjs for the read-only report
 * that found this: in college bc77d03b57194edeb006 (VISHNU INSTITUTE OF
 * TECHNOLOGY), 4 departments were renamed, orphaning 44 sections that still
 * store the old name (and leaving the assigned HOD's `departments[]` with
 * both the old and new name).
 *
 * This script reverts those 4 department docs' `name` field back to the
 * original name (which instantly reconnects the sections and other
 * department cross-references, since they were never touched and still say
 * the old name), and cleans up the affected HOD user docs so
 * `department`/`departments[]` point only at the old name (no duplicate).
 *
 * Safety: for each rename, it only acts if (a) a department doc currently
 * holds the NEW name, and (b) no department doc already holds the OLD name
 * (which would mean a collision / a different situation needing manual
 * review). Both conditions were confirmed true by the diagnostic script.
 *
 * Dry-run by default - prints exactly what it would write. Pass --apply to write.
 *
 * Usage:
 *   node scripts/revert-department-renames.mjs
 *   node scripts/revert-department-renames.mjs --apply
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
const APPLY = process.argv.includes("--apply");

const COLLEGE_ID = "bc77d03b57194edeb006"; // VISHNU INSTITUTE OF TECHNOLOGY

// new name -> old name
const RENAME_MAP = {
  "COMPUTER SCIENCE & ENGINEERING": "COMPUTER SCIENCE AND ENGINEERING",
  "COMPUTER SCIENCE AND BUSINESS SYSTEM": "Computer Science and Business Systems",
  "COMPUTER SCIENCE AND ENGINEERING (ARTIFICIAL INTELLIGENCE AND DATA SCIENCE)": "ARTIFICIAL INTELLIGENCE AND DATA SCIENCE",
  "COMPUTER SCIENCE AND ENGINEERING (ARTIFICIAL INTELLIGENCE AND MACHINE LEARNING)": "ARTIFICIAL INTELLIGENCE AND MACHINE LEARNING",
};

const norm = (s) => (s ?? "").trim();

async function run() {
  const collegeRef = db.collection("colleges").doc(COLLEGE_ID);
  const deptsSnap = await collegeRef.collection("departments").get();
  const byName = new Map();
  for (const d of deptsSnap.docs) {
    const name = norm(d.data().name);
    if (name) byName.set(name, d);
  }

  let deptWrites = 0;
  let userWrites = 0;

  for (const [newName, oldName] of Object.entries(RENAME_MAP)) {
    const newDoc = byName.get(newName);
    const oldDoc = byName.get(oldName);

    console.log(`\n--- "${newName}" -> "${oldName}" ---`);

    if (!newDoc) {
      console.log(`  SKIP: no department currently named "${newName}"`);
      continue;
    }
    if (oldDoc) {
      console.log(`  SKIP: a department (id=${oldDoc.id}) already has the old name "${oldName}" - collision, needs manual review`);
      continue;
    }

    console.log(`  departments/${newDoc.id}.name: "${newName}" -> "${oldName}"`);
    deptWrites++;
    if (APPLY) {
      await newDoc.ref.update({ name: oldName, updatedAt: new Date() });
    }

    // Fix the HOD (and any staff) user docs that got updated to the new name.
    const usersSnap = await collegeRef.collection("users").get();
    for (const u of usersSnap.docs) {
      const data = u.data();
      const patch = {};

      if (norm(data.department) === newName) {
        patch.department = oldName;
      }

      const deptArr = Array.isArray(data.departments) ? data.departments : null;
      if (deptArr && deptArr.includes(newName)) {
        const deduped = Array.from(new Set(deptArr.map((n) => (norm(n) === newName ? oldName : n))));
        patch.departments = deduped;
      }

      if (Object.keys(patch).length > 0) {
        console.log(
          `  users/${u.id} (${data.name ?? data.email ?? "?"}): ` +
            Object.entries(patch)
              .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
              .join(", ")
        );
        userWrites++;
        if (APPLY) {
          await u.ref.update({ ...patch, updatedAt: new Date() });
        }
      }
    }
  }

  console.log(
    `\n${APPLY ? "Applied" : "Would apply"}: ${deptWrites} department name revert(s), ${userWrites} user doc fix(es).`
  );
  if (!APPLY) {
    console.log("\nDry run only - re-run with --apply to write these changes.");
  }
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
