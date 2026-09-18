/**
 * One-time rollout seed for the Designation Catalog (colleges/{id}/designations).
 *
 * Designations used to be a hardcoded, per-college-type list baked into
 * src/lib/designations/config.ts. That's now each college's own
 * admin-curated catalog (see DesignationCatalogCard / api/college/
 * designations) - Faculty/Supporting Staff Add-Edit, CSV import, and the
 * Hiring role picker all read it directly. Shipped with no data migration,
 * so an EXISTING college's catalog starts empty and nobody could add a new
 * Faculty/Supporting Staff member until an admin manually rebuilt the whole
 * list by hand. This script seeds each existing college's catalog from
 * whatever their college type's old hardcoded list already offered, so nothing
 * is stranded. A college created AFTER this script has run gets no seed data
 * at all - empty catalog, admin builds it from scratch, same as Course Catalog.
 *
 * Faculty entries for ENGINEERING/PHARMACY/DENTAL colleges are additionally
 * tagged with an AICTE `cadre` (Professor/Associate Professor/Assistant
 * Professor) matching the old literal-code cadre-ratio counting in
 * api/college/faculty-requirement/route.ts, so that report keeps working
 * immediately after rollout. Degree/Polytechnic/School have no cadre-ratio
 * requirement, so their Faculty entries are seeded with no cadre tag.
 *
 * Idempotent: a (college, category, name) that already exists is left
 * untouched - safe to re-run.
 *
 * Usage: node scripts/backfill-designation-catalog.mjs                 (dry run, all colleges)
 *        node scripts/backfill-designation-catalog.mjs --apply
 *        node scripts/backfill-designation-catalog.mjs --apply --college "TEST COLLEGE"
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

// ─── Mirrors the now-removed per-college-type lists in src/lib/designations/config.ts ──

const ENGINEERING_TEACHING = ["PROFESSOR", "ASSOCIATE_PROFESSOR", "ASSISTANT_PROFESSOR", "LECTURER", "VISITING_FACULTY", "ADJUNCT_FACULTY"];
const LEGACY_TECHNICAL = ["LAB_ASSISTANT", "PROGRAMMER", "SYSTEM_ADMINISTRATOR", "NETWORK_ENGINEER"];
const ENGINEERING_SUPPORTING = ["OFFICE_STAFF", "ACCOUNTANT", "CLERK", "ATTENDER", "OFFICE_ASSISTANT", ...LEGACY_TECHNICAL];

const TEACHING_BY_TYPE = {
  ENGINEERING: ENGINEERING_TEACHING,
  PHARMACY: ENGINEERING_TEACHING,
  DENTAL: ENGINEERING_TEACHING,
  DEGREE: [
    "Principal", "Vice Principal", "Controller of Examinations", "Deputy Controller of Examinations",
    "Head of the Department", "Associate Professor", "Assistant Professor", "Teaching Assistant",
  ],
  POLYTECHNIC: ["Principal", "HOD", "Senior Lecturer", "Lecturer"],
  SCHOOL: ["Principal", "Vice-Principal", "HOD", "PGT", "TGT", "PRT", "Librarian", "Physical Education", "Art & Craft", "Drawing"],
};

const TECHNICAL_BY_TYPE = {
  ENGINEERING: LEGACY_TECHNICAL,
  PHARMACY: LEGACY_TECHNICAL,
  DENTAL: LEGACY_TECHNICAL,
  DEGREE: ["Lab Assistant", "Programmer", "Network I/C"],
  POLYTECHNIC: ["Sr. Lab Technician", "Drawing Assistant", "Lab Assistant", "Programmer", "Computer Operator", "Lab Technician"],
  SCHOOL: [],
};

const SUPPORTING_BY_TYPE = {
  ENGINEERING: ENGINEERING_SUPPORTING,
  PHARMACY: ENGINEERING_SUPPORTING,
  DENTAL: ENGINEERING_SUPPORTING,
  DEGREE: ["AO", "Sr. Office Assistant", "Office Assistant", "Lab Assistant", "Librarian", "Programmer", "Network I/C", "Trainee"],
  POLYTECHNIC: ["A.A.O", "Sr. Lab Technician", "Drawing Assistant", "Lab Assistant", "Programmer", "Office Assistant", "Computer Operator", "Lab Technician", "Attender"],
  SCHOOL: ["AO", "AAO", "Clerk cum Typist & Record Assistant", "Vehicle In-Charge", "Stores In-Charge", "Receptionist", "Office Assistant"],
};

// Only ENGINEERING/PHARMACY/DENTAL have an AICTE cadre-ratio requirement.
const CADRE_BY_NAME = {
  PROFESSOR: "PROFESSOR",
  ASSOCIATE_PROFESSOR: "ASSOCIATE_PROFESSOR",
  ASSOCIATE_PROFESSOR_SR: "ASSOCIATE_PROFESSOR",
  ASSISTANT_PROFESSOR: "ASSISTANT_PROFESSOR",
  LECTURER: "ASSISTANT_PROFESSOR",
};

function teachingFor(type) { return TEACHING_BY_TYPE[type] ?? ENGINEERING_TEACHING; }
function technicalFor(type) { return TECHNICAL_BY_TYPE[type] ?? LEGACY_TECHNICAL; }
function supportingFor(type) { return SUPPORTING_BY_TYPE[type] ?? ENGINEERING_SUPPORTING; }
function nonTechnicalFor(type) {
  const technical = technicalFor(type);
  if (technical.length === 0) return supportingFor(type);
  return supportingFor(type).filter((d) => !technical.includes(d));
}

async function seedCategory(collegeRef, existingByCategory, category, names, cadreLookup) {
  const existingNames = new Set((existingByCategory[category] ?? []).map((n) => n.toLowerCase()));
  const additions = [];
  for (const name of names) {
    if (existingNames.has(name.toLowerCase())) continue;
    additions.push({ name, category, ...(cadreLookup?.[name] ? { cadre: cadreLookup[name] } : {}) });
  }
  if (additions.length === 0) return 0;
  console.log(`    ${category}: +${additions.length} (${additions.map((a) => a.name).join(", ")})`);
  if (APPLY) {
    const now = new Date();
    for (const a of additions) {
      await collegeRef.collection("designations").add({
        collegeId: collegeRef.id,
        name: a.name,
        category: a.category,
        ...(a.cadre ? { cadre: a.cadre } : {}),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return additions.length;
}

async function run() {
  const collegesSnap = await db.collection("colleges").get();
  let totalAdded = 0;

  for (const college of collegesSnap.docs) {
    const data = college.data();
    if (COLLEGE_FILTER && data.name !== COLLEGE_FILTER) continue;

    // Never overwrite/duplicate an existing entry (seeded before, or an
    // admin already started building their own list) - only fill in
    // categories/names genuinely missing.
    const existingSnap = await college.ref.collection("designations").get();
    const existingByCategory = {};
    for (const d of existingSnap.docs) {
      const item = d.data();
      (existingByCategory[item.category] ??= []).push(item.name);
    }

    const type = data.type;
    console.log(`\n=== ${data.name ?? college.id} (type: ${type ?? "unset"}) ===`);

    const facultyCadre = type === "ENGINEERING" || type === "PHARMACY" || type === "DENTAL" ? CADRE_BY_NAME : undefined;
    const added =
      (await seedCategory(college.ref, existingByCategory, "FACULTY", teachingFor(type), facultyCadre)) +
      (await seedCategory(college.ref, existingByCategory, "TECHNICAL", technicalFor(type), undefined)) +
      (await seedCategory(college.ref, existingByCategory, "NON_TECHNICAL", nonTechnicalFor(type), undefined));

    if (added === 0) console.log("    (nothing to add)");
    totalAdded += added;
  }

  console.log(`\n${APPLY ? "Added" : "Would add"} ${totalAdded} designation(s) total.`);
  if (!APPLY) console.log("\nDry run only - re-run with --apply to write these changes.");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
