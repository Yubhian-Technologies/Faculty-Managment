/**
 * One-time migration: convert every FacultyMember record holding one of the
 * old "Technical" Designation codes (colleges/{id}/facultyMembers,
 * designation in LAB_ASSISTANT/PROGRAMMER/SYSTEM_ADMINISTRATOR/
 * NETWORK_ENGINEER) into a Supporting Staff record (colleges/{id}/
 * supportingStaff) and flip its login's role from PANEL_MEMBER to
 * COLLEGE_STAFF, following the "Technical designations move to Supporting
 * Staff" change (see src/lib/designations/config.ts). This is the reverse
 * direction of scripts/migrate-technical-staff-to-faculty.mjs.
 *
 * FacultyMember's old `technicalProfile` (skills/responsibilities/vendor
 * certifications) has no equivalent shape on SupportingStaffProfileFields'
 * `nonTechnicalProfile` - rather than force-mapping it into a shape it
 * doesn't fit and losing data, this script carries it over verbatim under a
 * new `legacyTechnicalProfile` field on the migrated record (not read by any
 * UI yet, but preserved and inspectable).
 *
 * Dry-run by default - prints exactly what it would do without writing
 * anything. Pass --commit to actually perform the migration.
 *
 * Usage:
 *   node scripts/migrate-technical-staff-to-supporting-staff.mjs            # dry run
 *   node scripts/migrate-technical-staff-to-supporting-staff.mjs --commit   # for real
 *   node scripts/migrate-technical-staff-to-supporting-staff.mjs --commit --college=<id>   # one college only
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0];
  const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
  const privateKey = rawKey.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

const db = getFirestore(getAdminApp());

const COMMIT = process.argv.includes("--commit");
const collegeArg = process.argv.find((a) => a.startsWith("--college="));
const ONLY_COLLEGE = collegeArg ? collegeArg.split("=")[1] : null;

// The 4 legacy Designation codes being retired from FacultyMember - see
// LEGACY_TECHNICAL_DESIGNATIONS in src/lib/designations/config.ts (kept as a
// literal list here so this script has no dependency on the TS build).
const TECHNICAL_DESIGNATIONS = ["LAB_ASSISTANT", "PROGRAMMER", "SYSTEM_ADMINISTRATOR", "NETWORK_ENGINEER"];

// Fields that share the exact same name/shape on both FacultyMember and
// SupportingStaffMember - copied verbatim.
const DIRECT_FIELDS = [
  "name", "phone", "department", "employeeId", "joiningDate", "employmentType", "status",
  "gender", "dateOfBirth", "legalName", "fatherName", "motherName", "religion", "caste",
  "aadharNo", "panNo", "passportNumber", "emergencyContactName", "emergencyContactPhone",
  "ratificationStatus", "ratificationDate", "maritalStatus", "spouseName", "numberOfChildren",
  "referral", "nativePlace", "temporaryAddress", "permanentSameAsTemporary", "permanentAddress",
  "bloodGroup", "profilePhotoUrl", "joiningLetterUrl", "appointmentLetterUrl", "experienceYears",
];

function buildSupportingStaffPayload(faculty, now) {
  const payload = { collegeId: faculty.collegeId, staffCategory: "NON_TECHNICAL" };
  for (const key of DIRECT_FIELDS) {
    if (faculty[key] !== undefined) payload[key] = faculty[key];
  }

  payload.designation = faculty.designation;
  payload.collegeEmail = faculty.collegeEmail || faculty.email || "";
  if (faculty.email && faculty.collegeEmail) payload.email = faculty.email;
  if (faculty.userUid) payload.userUid = faculty.userUid;

  // FacultyMember's qualification/specialization have no structured-
  // qualifications equivalent on SupportingStaffProfileFields - fold what's
  // there into a single qualifications[0] entry rather than lose it.
  if (faculty.qualification || faculty.specialization) {
    payload.supportingStaffProfile = {
      qualifications: [{
        level: "", degree: faculty.qualification ?? "", branch: faculty.specialization ?? "",
        universityOrInstitute: "", percentageOrDivision: "", yearOfCompletion: 0,
      }],
    };
  }

  // Not force-mapped into nonTechnicalProfile's different shape (skills/
  // responsibilities/vendor certs vs. office-admin responsibilities/computer
  // skills don't correspond field-for-field) - preserved verbatim instead.
  if (faculty.technicalProfile) {
    payload.legacyTechnicalProfile = faculty.technicalProfile;
  }

  payload.experienceYears = payload.experienceYears ?? 0;
  payload.status = payload.status ?? "ACTIVE";
  payload.employmentType = payload.employmentType ?? "PERMANENT";
  payload.createdAt = faculty.createdAt ?? now;
  payload.updatedAt = now;

  return payload;
}

async function migrateCollege(collegeId) {
  const facultySnap = await db
    .collection("colleges").doc(collegeId).collection("facultyMembers")
    .where("designation", "in", TECHNICAL_DESIGNATIONS)
    .get();

  if (facultySnap.empty) return { collegeId, migrated: 0, failed: [] };

  const existingEmployeeIds = new Set(
    (await db.collection("colleges").doc(collegeId).collection("supportingStaff").select("employeeId").get())
      .docs.map((d) => d.data().employeeId)
  );

  const now = new Date();
  let migrated = 0;
  const failed = [];

  for (const doc of facultySnap.docs) {
    const faculty = { id: doc.id, ...doc.data() };
    const label = `${faculty.employeeId ?? doc.id} (${faculty.name ?? "unnamed"})`;

    if (!faculty.name || !faculty.employeeId || !faculty.joiningDate) {
      failed.push({ id: doc.id, label, reason: "missing required field (name/employeeId/joiningDate)" });
      continue;
    }
    if (existingEmployeeIds.has(faculty.employeeId)) {
      failed.push({ id: doc.id, label, reason: `employeeId "${faculty.employeeId}" already exists in supportingStaff - skipped, resolve manually` });
      continue;
    }

    const payload = buildSupportingStaffPayload(faculty, now);
    console.log(`  [${COMMIT ? "MIGRATING" : "would migrate"}] ${label} - designation ${faculty.designation}${faculty.userUid ? `, login ${faculty.userUid}` : ", no login"}`);

    if (!COMMIT) {
      migrated++;
      existingEmployeeIds.add(faculty.employeeId);
      continue;
    }

    const collegeRef = db.collection("colleges").doc(collegeId);
    const staffRef = collegeRef.collection("supportingStaff").doc();

    try {
      await staffRef.set(payload);

      if (faculty.userUid) {
        await collegeRef.collection("users").doc(faculty.userUid)
          .set({ role: "COLLEGE_STAFF", updatedAt: now }, { merge: true });
        await db.collection("systemUsers").doc(faculty.userUid)
          .set({ role: "COLLEGE_STAFF" }, { merge: true });
      }

      await doc.ref.delete();
      migrated++;
      existingEmployeeIds.add(faculty.employeeId);
    } catch (err) {
      // Roll back the supporting-staff doc if anything after it failed, so
      // we don't leave a half-migrated record behind.
      await staffRef.delete().catch(() => {});
      failed.push({ id: doc.id, label, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { collegeId, migrated, failed };
}

async function run() {
  console.log(COMMIT ? "Running migration (writes will be committed)...\n" : "Dry run (pass --commit to actually migrate)...\n");

  const collegeIds = ONLY_COLLEGE
    ? [ONLY_COLLEGE]
    : (await db.collection("colleges").get()).docs.map((d) => d.id);

  let totalMigrated = 0;
  const allFailed = [];

  for (const collegeId of collegeIds) {
    const result = await migrateCollege(collegeId);
    if (result.migrated === 0 && result.failed.length === 0) continue;
    console.log(`College ${collegeId}: ${result.migrated} ${COMMIT ? "migrated" : "to migrate"}, ${result.failed.length} failed`);
    totalMigrated += result.migrated;
    allFailed.push(...result.failed.map((f) => ({ collegeId, ...f })));
  }

  console.log(`\nTotal: ${totalMigrated} ${COMMIT ? "migrated" : "would be migrated"}, ${allFailed.length} failed`);
  if (allFailed.length > 0) {
    console.log("\nFailed records (not migrated, need manual review):");
    for (const f of allFailed) console.log(`  - [${f.collegeId}] ${f.label}: ${f.reason}`);
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
