/**
 * Backfills `regulation` onto existing course/year-scoped Subject docs that
 * predate the field (see src/types/teaching.ts, api/college/subjects/route.ts).
 *
 * For each college, each such subject is matched against
 * colleges/{collegeId}/settings/academicRegulations' `yearRegulations` map
 * (the one regulation the Principal has fixed for that year of study, see
 * RegulationSettingsCard) using the subject's own `year`. Subjects with no
 * `courseId`/`year` (semester-scoped, created via the HOD's Teaching
 * Assignments page) are left untouched - regulation doesn't apply to that
 * shape. Subjects whose year has no regulation fixed in Settings are left
 * untouched and reported, since there's nothing to backfill them to; add
 * that year's regulation under Settings > Academic Regulations first, then
 * re-run.
 *
 * Usage: node scripts/backfill-subject-regulations.mjs                 (dry run)
 *        node scripts/backfill-subject-regulations.mjs --apply         (all colleges)
 *        node scripts/backfill-subject-regulations.mjs --apply --college "TEST COLLEGE"
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

async function run() {
  const collegesSnap = await db.collection("colleges").get();
  let totalBackfilled = 0;
  let totalUnresolved = 0;
  let totalSkipped = 0;

  for (const collegeDoc of collegesSnap.docs) {
    const collegeName = collegeDoc.data().name ?? "?";
    if (COLLEGE_FILTER && collegeName.trim().toLowerCase() !== COLLEGE_FILTER.trim().toLowerCase()) continue;

    const collegeRef = collegeDoc.ref;
    const [regSnap, subjectsSnap] = await Promise.all([
      collegeRef.collection("settings").doc("academicRegulations").get(),
      collegeRef.collection("subjects").get(),
    ]);

    const yearRegulations = regSnap.exists ? (regSnap.data().yearRegulations ?? {}) : {};

    const candidates = subjectsSnap.docs.filter((d) => {
      const x = d.data();
      return x.courseId && x.year != null && !x.regulation;
    });
    if (candidates.length === 0) continue;

    console.log(`\n=== College ${collegeDoc.id} (${collegeName}) ===`);

    const batch = db.batch();
    let batchHasWrites = false;

    for (const d of candidates) {
      const x = d.data();
      const regulation = yearRegulations[String(x.year)];
      if (!regulation) {
        console.log(`  [unresolved] subject=${d.id} "${x.name}" (${x.code}) year=${x.year} - no regulation fixed for this year in Settings`);
        totalUnresolved++;
        continue;
      }
      console.log(`  [backfill] subject=${d.id} "${x.name}" (${x.code}) year=${x.year} -> regulation=${regulation}`);
      totalBackfilled++;
      if (APPLY) {
        batch.update(d.ref, { regulation, updatedAt: new Date() });
        batchHasWrites = true;
      }
    }

    const semesterScoped = subjectsSnap.docs.length - candidates.length;
    totalSkipped += semesterScoped;

    if (APPLY && batchHasWrites) await batch.commit();
  }

  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN (pass --apply to write)"}`);
  console.log(`  backfilled: ${totalBackfilled}`);
  console.log(`  unresolved (no regulation fixed for that year): ${totalUnresolved}`);
  console.log(`  skipped (semester-scoped or already had a regulation): ${totalSkipped}`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
