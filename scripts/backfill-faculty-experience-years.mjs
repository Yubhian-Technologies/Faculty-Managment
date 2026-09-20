/**
 * Corrects `FacultyMember.totalYearsOfExperience` on every faculty record.
 * (Its legacy name, `experienceYears`, is read as a fallback and removed from any
 * doc this script writes - it must never be re-created here; see
 * src/lib/faculty/fieldRenames.ts.)
 *
 * That field is labeled "Total Years of Experience" everywhere it's shown
 * (Add Faculty form, CSV export, resume PDF, public profile) but was, until
 * now, only ever set to the sum of the Academic/Industry/Research
 * Experience entries (external experience) - it never included time served
 * since Date of Joining (internal experience). See src/lib/faculty/
 * experienceCalc.ts's experienceBreakdown, which every write path
 * (POST/PATCH /api/college/faculty[/[id]], link-hod) now uses instead.
 *
 * (The app now also has a runtime fallback for this - the Faculty List,
 * Faculty Details, CSV export, resume PDF, and public profile all compute
 * Total/Internal/External live from joiningDate + academicProfile rather
 * than trusting this stored field, so they already show the correct number
 * without this script. Running it still helps: it corrects the one raw
 * `experienceYears` value itself, for any remaining reader that trusts it
 * as stored - e.g. a lean read that only fetches {status, experienceYears}
 * - and stops it from reading as understated by however many years of
 * internal tenure it was missing.)
 *
 * Every faculty record with a `joiningDate` or any previous-experience entry
 * is recomputed as internalDays + externalDays, summed as exact days first
 * and rounded once at the end - the same math as experienceBreakdown - so
 * the corrected value matches what the live UI already shows as of the
 * moment this script runs (Internal keeps ticking up daily after that,
 * same as everywhere else it's shown).
 *
 * Usage: node scripts/backfill-faculty-experience-years.mjs                 (dry run, all colleges)
 *        node scripts/backfill-faculty-experience-years.mjs --apply
 *        node scripts/backfill-faculty-experience-years.mjs --apply --college "TEST COLLEGE"
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

// --- mirrors src/lib/faculty/experienceCalc.ts ---
function toJsDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  return null;
}
function exactDays(from, to) {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}
function rowDates(r) {
  return {
    fromDate: r.fromDate ?? (r.fromYear ? `${r.fromYear}-01-01` : undefined),
    toDate: r.toDate ?? (r.toYear ? `${r.toYear}-01-01` : undefined),
  };
}
function allPreviousExperienceEntries(ap) {
  if (!ap) return [];
  return [
    // Current key names first, legacy names (previousInstitutions /
    // industryExperienceEntries / researchExperienceEntries) as read-fallbacks
    // for docs not yet through migrate-faculty-field-names.mjs.
    ...(ap.academicExperience ?? ap.previousInstitutions ?? []),
    ...(ap.industryExperience ?? ap.industryExperienceEntries ?? []),
    ...(ap.researchExperience ?? ap.researchExperienceEntries ?? []),
  ];
}
function totalPreviousExperienceDays(rows) {
  if (!rows || rows.length === 0) return 0;
  return rows.reduce((sum, r) => {
    const { fromDate, toDate } = rowDates(r);
    if (!fromDate || !toDate) return sum;
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return sum;
    return sum + exactDays(from, to);
  }, 0);
}
function experienceTotalYears(ap, joiningDate, asOf) {
  const externalDays = totalPreviousExperienceDays(allPreviousExperienceEntries(ap));
  const joined = toJsDate(joiningDate);
  const internalDays = joined ? Math.max(0, exactDays(joined, asOf)) : 0;
  return Math.round(((internalDays + externalDays) / 365.25) * 10) / 10;
}

async function run() {
  const asOf = new Date();
  const collegesSnap = await db.collection("colleges").get();
  let totalChecked = 0;
  let totalCorrected = 0;

  for (const collegeDoc of collegesSnap.docs) {
    const collegeName = collegeDoc.data().name ?? "?";
    if (COLLEGE_FILTER && collegeName.trim().toLowerCase() !== COLLEGE_FILTER.trim().toLowerCase()) continue;

    const facultySnap = await collegeDoc.ref.collection("facultyMembers").get();
    if (facultySnap.empty) continue;

    let collegeHeaderPrinted = false;
    const batch = db.batch();
    let batchHasWrites = false;

    for (const doc of facultySnap.docs) {
      totalChecked++;
      const x = doc.data();
      const correctTotal = experienceTotalYears(x.academicProfile, x.joiningDate, asOf);
      // New key wins; the legacy twin is only a read fallback for un-migrated docs.
      const stored = x.totalYearsOfExperience ?? x.experienceYears;
      const storedTotal = typeof stored === "number" ? stored : 0;
      // A doc already at the right value is skipped, unless it still carries the
      // legacy key - then only that key is cleaned up (value is already correct).
      const hasLegacy = "experienceYears" in x;
      if (correctTotal === storedTotal && !hasLegacy) continue;

      if (!collegeHeaderPrinted) {
        console.log(`\n=== College ${collegeDoc.id} (${collegeName}) ===`);
        collegeHeaderPrinted = true;
      }
      console.log(`  ${APPLY ? "WRITE" : "PLAN "} ${x.employeeId ?? doc.id}: totalYearsOfExperience ${storedTotal} -> ${correctTotal}${hasLegacy ? " (removing legacy experienceYears)" : ""}`);
      totalCorrected++;

      if (APPLY) {
        batch.update(doc.ref, {
          totalYearsOfExperience: correctTotal,
          ...(hasLegacy ? { experienceYears: FieldValue.delete() } : {}),
          updatedAt: asOf,
        });
        batchHasWrites = true;
      }
    }

    if (APPLY && batchHasWrites) await batch.commit();
  }

  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN (pass --apply to write)"}`);
  console.log(`  faculty records checked: ${totalChecked}`);
  console.log(`  faculty records corrected: ${totalCorrected}`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
