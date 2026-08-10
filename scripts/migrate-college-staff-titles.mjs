/**
 * One-time script: promote free-text COLLEGE_STAFF designations ("Dean - R&D",
 * "IQAC Coordinator", "T&P", ...) to the dedicated DEAN / IQAC_COORDINATOR /
 * T_AND_P / R_AND_D roles introduced alongside this script.
 *
 * Steps:
 *   1. Edit the SERVICE_ACCOUNT_PATH constant below.
 *   2. Run once with DRY_RUN = true (default) to review the matches it finds -
 *      nothing is written to Firestore in this mode.
 *   3. Flip DRY_RUN to false and re-run to apply the changes.
 *
 *      node scripts/migrate-college-staff-titles.mjs
 */

import { readFileSync } from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// ── Edit this line ────────────────────────────────────────────────────────────
const SERVICE_ACCOUNT_PATH = "/Users/rishi/Downloads/faculty-management-37e84-firebase-adminsdk-fbsvc-9001715fc7.json";
// ─────────────────────────────────────────────────────────────────────────────

// Set to false to actually write the role changes. Defaults to a dry run.
const DRY_RUN = true;

// Checked in order, first match wins. Keep DEAN last since "R&D" titles are
// often phrased "Dean - R&D" and should land on R_AND_D, not DEAN.
const MATCHERS = [
  { role: "IQAC_COORDINATOR", test: (d) => d.includes("iqac") },
  { role: "T_AND_P", test: (d) => d.includes("t&p") || d.includes("t & p") || d.includes("training and placement") || d.includes("training & placement") },
  { role: "R_AND_D", test: (d) => d.includes("r&d") || d.includes("r & d") || d.includes("research and development") || d.includes("research & development") },
  { role: "DEAN", test: (d) => d.includes("dean") },
];

function matchRole(designation) {
  const d = (designation ?? "").toLowerCase();
  for (const m of MATCHERS) {
    if (m.test(d)) return m.role;
  }
  return null;
}

const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

async function run() {
  const collegesSnap = await db.collection("colleges").get();

  const matched = [];
  const skipped = [];

  for (const collegeDoc of collegesSnap.docs) {
    const usersSnap = await collegeDoc.ref.collection("users").where("role", "==", "COLLEGE_STAFF").get();

    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      const newRole = matchRole(data.designation);
      const row = { collegeId: collegeDoc.id, uid: userDoc.id, name: data.name ?? "", designation: data.designation ?? "" };

      if (!newRole) {
        skipped.push(row);
        continue;
      }
      matched.push({ ...row, newRole });

      if (!DRY_RUN) {
        const batch = db.batch();
        batch.update(userDoc.ref, { role: newRole, designation: FieldValue.delete(), updatedAt: new Date() });
        batch.set(db.collection("systemUsers").doc(userDoc.id), { role: newRole }, { merge: true });
        await batch.commit();
      }
    }
  }

  console.log(`\n${DRY_RUN ? "[DRY RUN] Would update" : "Updated"} ${matched.length} user(s):`);
  console.table(matched.map(({ collegeId, uid, name, designation, newRole }) => ({ collegeId, uid, name, designation, newRole })));

  console.log(`\nSkipped (kept as COLLEGE_STAFF, no keyword match) - ${skipped.length} user(s):`);
  console.table(skipped.map(({ collegeId, uid, name, designation }) => ({ collegeId, uid, name, designation })));

  if (DRY_RUN) {
    console.log("\nDry run only - no writes were made. Set DRY_RUN = false in this script to apply.");
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
