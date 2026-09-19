/**
 * One-time migration: renames the stored Faculty Details keys to the names the
 * Faculty Details UI labels use (e.g. degree -> course, yearOfCompletion ->
 * yearOfPassing / yearOfAward, certificateNumber -> hallTicketNumber, location ->
 * place, trainingEntries -> fdpsWorkshopsMoocsCertifications, qualification ->
 * highestQualification, experienceYears -> totalYearsOfExperience, ...).
 *
 * The full old -> new table lives in src/lib/faculty/fieldRenames.ts - this
 * script imports that same file (Node's native TypeScript type stripping), so
 * the migration and the app's read-time fallback can never disagree.
 *
 * Covers three collections, because they share the renamed shapes:
 *   - colleges/{id}/facultyMembers   top-level qualification/experienceYears,
 *                                    flat personal keys, academicProfile.*
 *   - colleges/{id}/users            flat personal keys, academicProfile.*
 *   - colleges/{id}/supportingStaff  flat personal keys, supportingStaffProfile.
 *                                    qualifications / nonTechnicalProfile.training /
 *                                    nonTechnicalProfile.achievements
 *
 * Idempotent (a migrated doc is skipped) and safe against concurrent edits: each
 * write carries the doc's lastUpdateTime as a precondition, so a doc someone
 * saved between this script's read and write is skipped (re-run to pick it up).
 * Does NOT bump updatedAt - this is a key rename, not a user edit.
 *
 * Dry-run by default - prints exactly what it would change without writing
 * anything. Pass --apply to actually perform the migration.
 *
 * ORDER OF OPERATIONS: deploy the app version that reads the new key names
 * first (it also understands old names, so nothing breaks in between), THEN run
 * this with --apply. Running it before the deploy would make the still-deployed
 * old code read every renamed field as empty.
 *
 * Usage:
 *   node scripts/migrate-faculty-field-names.mjs                       # dry run, all colleges
 *   node scripts/migrate-faculty-field-names.mjs --apply
 *   node scripts/migrate-faculty-field-names.mjs --apply --college "TEST COLLEGE"
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { migrateFacultyDoc, migrateUserDoc, migrateSupportingStaffDoc } from "../src/lib/faculty/fieldRenames.ts";

const APPLY = process.argv.includes("--apply");
const collegeArgIdx = process.argv.indexOf("--college");
const COLLEGE_FILTER = collegeArgIdx !== -1 ? process.argv[collegeArgIdx + 1] : null;

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

const COLLECTIONS = [
  { name: "facultyMembers", migrate: migrateFacultyDoc },
  { name: "users", migrate: migrateUserDoc },
  { name: "supportingStaff", migrate: migrateSupportingStaffDoc },
];

// Top-level keys whose value changes, and top-level keys the migration removed.
function diffTopLevel(before, after) {
  const set = {};
  const deleted = [];
  for (const key of Object.keys(before)) {
    if (!(key in after)) deleted.push(key);
    else if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) set[key] = after[key];
  }
  for (const key of Object.keys(after)) {
    if (!(key in before)) set[key] = after[key];
  }
  return { set, deleted };
}

async function run() {
  const collegesSnap = await db.collection("colleges").get();
  const totals = { checked: 0, changed: 0, skippedConcurrent: 0, failed: 0 };
  const perCollection = {};

  for (const collegeDoc of collegesSnap.docs) {
    const collegeName = collegeDoc.data().name ?? "?";
    if (COLLEGE_FILTER && collegeName.trim().toLowerCase() !== COLLEGE_FILTER.trim().toLowerCase()) continue;

    let headerPrinted = false;
    for (const { name, migrate } of COLLECTIONS) {
      const snap = await collegeDoc.ref.collection(name).get();
      for (const doc of snap.docs) {
        totals.checked++;
        const before = doc.data();
        const after = migrate(before);
        const { set, deleted } = diffTopLevel(before, after);
        const touched = [...Object.keys(set), ...deleted.map((k) => `-${k}`)];
        if (touched.length === 0) continue;

        totals.changed++;
        perCollection[name] = (perCollection[name] ?? 0) + 1;
        if (!headerPrinted) {
          console.log(`\n=== College ${collegeDoc.id} (${collegeName}) ===`);
          headerPrinted = true;
        }
        const label = before.legalName || before.name || before.employeeId || doc.id;
        console.log(`  ${APPLY ? "WRITE" : "PLAN "} ${name}/${label}: ${touched.join(", ")}`);

        if (APPLY) {
          const updates = { ...set };
          for (const key of deleted) updates[key] = FieldValue.delete();
          try {
            await doc.ref.update(updates, { lastUpdateTime: doc.updateTime });
          } catch (e) {
            // FAILED_PRECONDITION (code 9): edited since we read it.
            if (e && (e.code === 9 || /FAILED_PRECONDITION/.test(String(e.message)))) {
              totals.skippedConcurrent++;
              console.log(`    SKIP  edited concurrently - re-run to pick it up`);
            } else {
              totals.failed++;
              console.error(`    FAIL  ${e.message ?? e}`);
            }
          }
        }
      }
    }
  }

  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN (pass --apply to write)"}`);
  console.log(`  documents checked: ${totals.checked}`);
  console.log(`  documents ${APPLY ? "migrated" : "to migrate"}: ${totals.changed - totals.skippedConcurrent - totals.failed}`);
  for (const [name, n] of Object.entries(perCollection)) console.log(`    ${name}: ${n}`);
  if (APPLY) {
    console.log(`  skipped (edited concurrently): ${totals.skippedConcurrent}`);
    console.log(`  failed: ${totals.failed}`);
  }
  process.exit(totals.failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
