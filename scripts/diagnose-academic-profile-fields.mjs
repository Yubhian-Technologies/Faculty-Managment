/**
 * Read-only diagnostic: scans every faculty record's `academicProfile` across
 * every college and reports every distinct top-level key actually present in
 * Firestore, with how many records carry it and up to 3 example employeeIds -
 * cross-referenced against the keys the current FacultyProfileFields type
 * (src/types/core.ts) and the current Academic Qualification/Professional
 * Development edit+display UI (AcademicProfileModuleFields.tsx/
 * ProfileFieldsView.tsx) actually know about.
 *
 * Any key printed under "NOT IN CURRENT SCHEMA" is a legacy/renamed leftover:
 * real data sitting in Firestore that the current UI never reads, writes, or
 * shows - a prime suspect for "field names don't match the UI" /
 * "some [fields] are not removed" reports. Reads only - writes nothing.
 *
 * Usage: node scripts/diagnose-academic-profile-fields.mjs
 *        node scripts/diagnose-academic-profile-fields.mjs --college "TEST COLLEGE"
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

// Every top-level academicProfile key the current type (src/types/core.ts,
// FacultyProfileFields) declares, as of the fix this diagnostic supports.
const KNOWN_KEYS = new Set([
  "highestQualification", "researchAreas", "highSchoolDetails", "intermediateDetails",
  "ugDetails", "additionalUgDetails", "pgDetails", "additionalPgDetails",
  "phdDetails", "additionalPhdDetails", "postDoctoralDetails",
  "qualifyingExamQualified", "qualifyingExam", "otherQualifyingExam",
  "qualifyingExamScore", "qualifyingExamYear", "schoolQualifications",
  "teachingAssignment", "primaryIndustryRole", "primaryResearchRole",
  "previousInstitutions", "industryExperienceEntries", "researchExperienceEntries",
  "promotionHistory",
  "publications", "publicationsFirstOrCorrespondingAuthor", "publicationsQ1OrHighImpact",
  "sciScopusCount", "wosCount", "conferencePapersCount", "bookChaptersCount",
  "reviewPublicationsCount", "totalPublications", "totalCitations", "hIndex", "i10Index",
  "orcidId", "scopusAuthorId", "researcherId", "googleScholarId", "irinsProfile",
  "citationsTotal", "citationsHIndex", "citationsExcludingSelf", "citationsHIndexExcludingSelf",
  "labsEstablished", "authoredBooks", "trainingEntries", "professionalMemberships",
  "adminResponsibilityEntries", "awardEntries",
  "presentSalary", "grossAnnualCTC", "incrementsAwarded", "fundingConsultancyRevenue",
  "otherInformation",
]);

async function run() {
  const collegesSnap = await db.collection("colleges").get();
  // key -> { count, examples: [employeeId], colleges: Set }
  const stats = new Map();
  let totalFaculty = 0;
  let totalWithProfile = 0;

  for (const collegeDoc of collegesSnap.docs) {
    const collegeName = collegeDoc.data().name ?? "?";
    if (COLLEGE_FILTER && collegeName.trim().toLowerCase() !== COLLEGE_FILTER.trim().toLowerCase()) continue;

    const facultySnap = await collegeDoc.ref.collection("facultyMembers").get();
    for (const doc of facultySnap.docs) {
      totalFaculty++;
      const x = doc.data();
      const ap = x.academicProfile;
      if (!ap || typeof ap !== "object") continue;
      totalWithProfile++;

      for (const key of Object.keys(ap)) {
        const value = ap[key];
        // Skip keys whose value is empty/blank - not interesting either way.
        const isEmpty = value == null || value === "" || (Array.isArray(value) && value.length === 0);
        if (isEmpty) continue;

        if (!stats.has(key)) stats.set(key, { count: 0, examples: [], colleges: new Set() });
        const s = stats.get(key);
        s.count++;
        s.colleges.add(collegeName);
        if (s.examples.length < 3) s.examples.push(`${x.employeeId ?? doc.id} (${collegeName})`);
      }
    }
  }

  const allKeys = Array.from(stats.keys()).sort();
  const known = allKeys.filter((k) => KNOWN_KEYS.has(k));
  const unknown = allKeys.filter((k) => !KNOWN_KEYS.has(k));

  console.log(`Faculty records scanned: ${totalFaculty} (${totalWithProfile} with an academicProfile object)\n`);

  console.log("=== Keys IN the current schema, with non-empty data ===");
  for (const k of known) {
    const s = stats.get(k);
    console.log(`  ${k}: ${s.count} record(s) across [${Array.from(s.colleges).join(", ")}]`);
  }

  console.log("\n=== Keys NOT IN the current schema (legacy/renamed - orphaned data) ===");
  if (unknown.length === 0) {
    console.log("  (none found)");
  } else {
    for (const k of unknown) {
      const s = stats.get(k);
      console.log(`  ${k}: ${s.count} record(s) across [${Array.from(s.colleges).join(", ")}] - e.g. ${s.examples.join(", ")}`);
    }
  }

  const declaredButNeverSeen = Array.from(KNOWN_KEYS).filter((k) => !stats.has(k)).sort();
  console.log("\n=== Keys IN the current schema but never seen with data anywhere ===");
  console.log(declaredButNeverSeen.length ? `  ${declaredButNeverSeen.join(", ")}` : "  (none)");

  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
