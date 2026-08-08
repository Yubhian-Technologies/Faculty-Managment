/**
 * One-time migration: convert every "Technical" Supporting Staff record
 * (colleges/{id}/supportingStaff, staffCategory === "TECHNICAL") into a
 * Faculty record (colleges/{id}/facultyMembers) and flip its login's role
 * from COLLEGE_STAFF to PANEL_MEMBER, following the "Technical Staff is now
 * part of Faculty" change (see AGENTS.md).
 *
 * Dry-run by default - prints exactly what it would do without writing
 * anything. Pass --commit to actually perform the migration.
 *
 * Usage:
 *   node scripts/migrate-technical-staff-to-faculty.mjs            # dry run
 *   node scripts/migrate-technical-staff-to-faculty.mjs --commit   # for real
 *   node scripts/migrate-technical-staff-to-faculty.mjs --commit --college=<id>   # one college only
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

// Fields that share the exact same name/shape on both SupportingStaffMember
// and FacultyMember (see AGENTS.md data-mapping notes) - copied verbatim.
const DIRECT_FIELDS = [
  "name", "phone", "department", "employeeId", "joiningDate", "employmentType", "status",
  "gender", "dateOfBirth", "legalName", "fatherName", "motherName", "religion", "caste",
  "aadharNo", "panNo", "passportNumber", "emergencyContactName", "emergencyContactPhone",
  "ratificationStatus", "ratificationDate", "maritalStatus", "spouseName", "numberOfChildren",
  "referral", "nativePlace", "temporaryAddress", "permanentSameAsTemporary", "permanentAddress",
  "bloodGroup", "profilePhotoUrl", "joiningLetterUrl", "appointmentLetterUrl", "experienceYears",
];

function buildFacultyPayload(staff, now) {
  const payload = { collegeId: staff.collegeId };
  for (const key of DIRECT_FIELDS) {
    if (staff[key] !== undefined) payload[key] = staff[key];
  }

  payload.designation = staff.designation;
  payload.collegeEmail = staff.collegeEmail || staff.email || "";
  if (staff.userUid) payload.userUid = staff.userUid;

  // No structured-qualifications equivalent on FacultyMember (single string
  // field) - synthesize from the first structured entry, if any.
  const q = staff.supportingStaffProfile?.qualifications?.[0];
  payload.qualification = q ? [q.level, q.degreeAndBranch].filter(Boolean).join(" - ") : "";

  // FacultyMember has no otherDesignationTitle equivalent - fold it into
  // specialization (closest semantic fit) rather than lose it.
  if (staff.otherDesignationTitle) payload.specialization = staff.otherDesignationTitle;

  if (staff.supportingStaffProfile?.technicalProfile) {
    payload.technicalProfile = staff.supportingStaffProfile.technicalProfile;
  }

  payload.experienceYears = payload.experienceYears ?? 0;
  payload.status = payload.status ?? "ACTIVE";
  payload.employmentType = payload.employmentType ?? "PERMANENT";
  payload.createdAt = staff.createdAt ?? now;
  payload.updatedAt = now;

  return payload;
}

async function migrateCollege(collegeId) {
  const staffSnap = await db
    .collection("colleges").doc(collegeId).collection("supportingStaff")
    .where("staffCategory", "==", "TECHNICAL")
    .get();

  if (staffSnap.empty) return { collegeId, migrated: 0, failed: [] };

  const existingEmployeeIds = new Set(
    (await db.collection("colleges").doc(collegeId).collection("facultyMembers").select("employeeId").get())
      .docs.map((d) => d.data().employeeId)
  );

  const now = new Date();
  let migrated = 0;
  const failed = [];

  for (const doc of staffSnap.docs) {
    const staff = { id: doc.id, ...doc.data() };
    const label = `${staff.employeeId ?? doc.id} (${staff.name ?? "unnamed"})`;

    if (!staff.name || !staff.employeeId || !staff.joiningDate) {
      failed.push({ id: doc.id, label, reason: "missing required field (name/employeeId/joiningDate)" });
      continue;
    }
    if (existingEmployeeIds.has(staff.employeeId)) {
      failed.push({ id: doc.id, label, reason: `employeeId "${staff.employeeId}" already exists in facultyMembers - skipped, resolve manually` });
      continue;
    }

    const payload = buildFacultyPayload(staff, now);
    console.log(`  [${COMMIT ? "MIGRATING" : "would migrate"}] ${label} - designation ${staff.designation}${staff.userUid ? `, login ${staff.userUid}` : ", no login"}`);

    if (!COMMIT) {
      migrated++;
      existingEmployeeIds.add(staff.employeeId);
      continue;
    }

    const collegeRef = db.collection("colleges").doc(collegeId);
    const facultyRef = collegeRef.collection("facultyMembers").doc();

    try {
      await facultyRef.set(payload);

      if (staff.userUid) {
        await collegeRef.collection("users").doc(staff.userUid)
          .set({ role: "PANEL_MEMBER", updatedAt: now }, { merge: true });
        await db.collection("systemUsers").doc(staff.userUid)
          .set({ role: "PANEL_MEMBER" }, { merge: true });
      }

      await doc.ref.delete();
      migrated++;
      existingEmployeeIds.add(staff.employeeId);
    } catch (err) {
      // Roll back the faculty doc if anything after it failed, so we don't
      // leave a half-migrated record behind.
      await facultyRef.delete().catch(() => {});
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
