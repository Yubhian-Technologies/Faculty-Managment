/**
 * One-time cleanup: strips a batch of dead/legacy fields off existing
 * FacultyMember documents that the Faculty Details cleanup (Add Faculty
 * wizard now the single source of truth for fields/order) removed from the
 * TypeScript schema, export columns, and every edit/view surface. Deleting a
 * TypeScript field does NOT touch documents that already have it set, so
 * without this script old records keep carrying stale data the app no
 * longer reads or writes anywhere.
 *
 * Removed top-level FacultyMember fields (colleges/{id}/facultyMembers/{id}):
 *   - hasPHD                 (dead - never set by Add/Edit, only old CSV import)
 *   - internalExperience     (now computed live from joiningDate - see
 *                              src/lib/faculty/experienceCalc.ts)
 *   - externalExperience     (now computed live from Academic/Industry/Research
 *                              Experience entries combined)
 *   - inCampusExperience     (dead - no UI ever wrote this)
 *   - industryExperience     (dead - duplicate of academicProfile.industryExperienceEntries)
 *   - researchExperience     (dead - duplicate of academicProfile.researchExperienceEntries)
 *   - employmentType         (legacy - superseded by employeeCategory)
 *   - dateOfJoiningDepartment (dead - accepted by old routes but never set by any UI)
 *   - aicteEligible          (removed at the user's request - see conversation)
 *
 * Removed academicProfile.* fields (the "Grants, Consultancy & IP" module,
 * permanently removed from the app, plus 4 legacy Professional Development
 * free-text fields already superseded by structured lists, plus 2 Ph.D.
 * fields with no Add/Edit UI, superseded by DegreeDetail.guideOrSupervisorName):
 *   - fundedProjects, consultancyProjects, patents
 *   - phdScholarsPursuing, phdScholarsAwarded, nationalExposure, internationalExposure
 *   - administrativeResponsibilities, certificationsAndFdps,
 *     professionalBodyMemberships, notableAwards
 *   - phdSupervisorName, fellowshipsReceived
 *
 * Dry-run by default - prints exactly what it would touch without writing
 * anything. Pass --apply to actually perform the cleanup.
 *
 * Usage:
 *   node scripts/cleanup-legacy-faculty-fields.mjs                       # dry run, all colleges
 *   node scripts/cleanup-legacy-faculty-fields.mjs --apply
 *   node scripts/cleanup-legacy-faculty-fields.mjs --apply --college "TEST COLLEGE"
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

const TOP_LEVEL_FIELDS = [
  "hasPHD",
  "internalExperience",
  "externalExperience",
  "inCampusExperience",
  "industryExperience",
  "researchExperience",
  "employmentType",
  "dateOfJoiningDepartment",
  "aicteEligible",
];

const ACADEMIC_PROFILE_FIELDS = [
  "fundedProjects",
  "consultancyProjects",
  "patents",
  "phdScholarsPursuing",
  "phdScholarsAwarded",
  "nationalExposure",
  "internationalExposure",
  "administrativeResponsibilities",
  "certificationsAndFdps",
  "professionalBodyMemberships",
  "notableAwards",
  "phdSupervisorName",
  "fellowshipsReceived",
];

async function run() {
  const collegesSnap = await db.collection("colleges").get();
  let totalDocsTouched = 0;
  let totalFieldsDeleted = 0;
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

      for (const key of TOP_LEVEL_FIELDS) {
        if (data[key] !== undefined) {
          updates[key] = FieldValue.delete();
          notes.push(key);
        }
      }
      for (const key of ACADEMIC_PROFILE_FIELDS) {
        if (ap[key] !== undefined) {
          updates[`academicProfile.${key}`] = FieldValue.delete();
          notes.push(`academicProfile.${key}`);
        }
      }

      if (notes.length === 0) { totalDocsOk++; continue; }

      if (!collegeHeaderPrinted) {
        console.log(`\n=== College ${collegeDoc.id} (${collegeName}) ===`);
        collegeHeaderPrinted = true;
      }
      const label = data.legalName || data.name || data.employeeId || doc.id;
      console.log(`  ${APPLY ? "WRITE" : "PLAN "} ${label}: ${notes.join(", ")}`);

      totalDocsTouched++;
      totalFieldsDeleted += notes.length;

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
  console.log(`  faculty records touched: ${totalDocsTouched}`);
  console.log(`  fields deleted: ${totalFieldsDeleted}`);
  console.log(`  faculty records already clean: ${totalDocsOk}`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
