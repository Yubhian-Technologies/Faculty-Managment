/**
 * One-time migration: moves Ph.D./Postdoctoral Status and Mode off their old
 * standalone FacultyProfileFields-level scalars and onto the degree entry
 * they actually describe (phdDetails.status/.mode,
 * postDoctoralDetails.status/.mode - see DegreeDetail in src/types/core.ts).
 *
 * Previously these lived as 4 separate top-level fields on academicProfile
 * (phdStatus, phdMode, postDoctoralStatus, postDoctoralMode), sitting beside
 * - not inside - the phdDetails/postDoctoralDetails object they were always
 * shown together with in the UI. That's been corrected in code; this script
 * carries existing data across so nothing is silently lost.
 *
 * For each faculty doc:
 *   - if academicProfile.phdStatus/phdMode is set, write it onto
 *     academicProfile.phdDetails.status/.mode (creating phdDetails as an
 *     object if the faculty member has a status/mode but somehow no
 *     phdDetails object yet), then delete the old top-level field.
 *   - same for postDoctoralStatus/postDoctoralMode -> postDoctoralDetails.
 *
 * Dry-run by default - prints exactly what it would touch without writing
 * anything. Pass --apply to actually perform the migration.
 *
 * Usage:
 *   node scripts/migrate-phd-status-mode-into-details.mjs                       # dry run, all colleges
 *   node scripts/migrate-phd-status-mode-into-details.mjs --apply
 *   node scripts/migrate-phd-status-mode-into-details.mjs --apply --college "TEST COLLEGE"
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

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

async function run() {
  const collegesSnap = await db.collection("colleges").get();
  let totalDocsTouched = 0;
  let totalDocsOk = 0;

  for (const collegeDoc of collegesSnap.docs) {
    const collegeName = collegeDoc.data().name ?? "?";
    if (COLLEGE_FILTER && collegeName.trim().toLowerCase() !== COLLEGE_FILTER.trim().toLowerCase()) continue;

    const facultySnap = await collegeDoc.ref.collection("facultyMembers").get();
    if (facultySnap.empty) continue;

    let collegeHeaderPrinted = false;
    let batch = db.batch();
    let batchHasWrites = false;
    let batchCount = 0;

    for (const doc of facultySnap.docs) {
      const data = doc.data();
      const ap = data.academicProfile ?? {};
      const updates = {};
      const notes = [];

      if (ap.phdStatus !== undefined || ap.phdMode !== undefined) {
        if (ap.phdStatus !== undefined) updates["academicProfile.phdDetails.status"] = ap.phdStatus;
        if (ap.phdMode !== undefined) updates["academicProfile.phdDetails.mode"] = ap.phdMode;
        updates["academicProfile.phdStatus"] = FieldValue.delete();
        updates["academicProfile.phdMode"] = FieldValue.delete();
        notes.push(`phdStatus/phdMode -> phdDetails.status/.mode (${ap.phdStatus ?? "-"} / ${ap.phdMode ?? "-"})`);
      }

      if (ap.postDoctoralStatus !== undefined || ap.postDoctoralMode !== undefined) {
        if (ap.postDoctoralStatus !== undefined) updates["academicProfile.postDoctoralDetails.status"] = ap.postDoctoralStatus;
        if (ap.postDoctoralMode !== undefined) updates["academicProfile.postDoctoralDetails.mode"] = ap.postDoctoralMode;
        updates["academicProfile.postDoctoralStatus"] = FieldValue.delete();
        updates["academicProfile.postDoctoralMode"] = FieldValue.delete();
        notes.push(`postDoctoralStatus/postDoctoralMode -> postDoctoralDetails.status/.mode (${ap.postDoctoralStatus ?? "-"} / ${ap.postDoctoralMode ?? "-"})`);
      }

      if (notes.length === 0) { totalDocsOk++; continue; }

      if (!collegeHeaderPrinted) {
        console.log(`\n=== College ${collegeDoc.id} (${collegeName}) ===`);
        collegeHeaderPrinted = true;
      }
      const label = data.legalName || data.name || data.employeeId || doc.id;
      console.log(`  ${APPLY ? "WRITE" : "PLAN "} ${label}: ${notes.join("; ")}`);

      totalDocsTouched++;

      if (APPLY) {
        updates.updatedAt = new Date();
        batch.update(doc.ref, updates);
        batchHasWrites = true;
        batchCount++;
        // Firestore batches cap at 500 writes.
        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }

    if (APPLY && batchHasWrites && batchCount > 0) await batch.commit();
  }

  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN (pass --apply to write)"}`);
  console.log(`  faculty records migrated: ${totalDocsTouched}`);
  console.log(`  faculty records already clean: ${totalDocsOk}`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
