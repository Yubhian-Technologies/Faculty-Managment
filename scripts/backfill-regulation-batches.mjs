/**
 * Backfills `regulationBatches` onto Course Catalog entries that predate it.
 *
 * The Course Catalog used to be Principal-owned and stored, per course, only
 * `regulations: string[]` plus an optional `regulationYears: Record<string,
 * number[]>` narrowing (which ordinal years each regulation was offered for;
 * absent meant "every year"). Ownership then moved to the Dean and that model
 * was replaced by `regulationBatches: Record<string, string>` - a
 * comma-separated list of "start-end" intake ranges per regulation, from
 * which every downstream picker now derives which ordinal year a regulation
 * governs (src/lib/college/academicSession.ts's
 * regulationsForCourseYearByBatch). That change shipped with NO data
 * migration, so a catalog entry created under the old model still has its
 * `regulations` list but no `regulationBatches` - and every consumer (Edit
 * Section's Regulation field, Add Subject, the sections POST/PATCH
 * validation) then resolves it to nothing and shows "None assigned for this
 * year" even though the Dean has clearly assigned e.g. R23.
 *
 * (The app now also has a runtime fallback for this - an empty
 * `regulationBatches` falls back to "all `regulations` offered for every
 * year" - so the pickers already work again without this script. Running it
 * still helps: it turns that guess into real, per-regulation intake coverage
 * so the year-narrowing is accurate for future sessions and the Dean's
 * catalog screen stops showing the amber "no intake batches set" hint.)
 *
 * For each regulation code with no batch coverage, a batch string is
 * synthesized, in order of preference:
 *   1. legacy `regulationYears[code]` present  -> one batch per listed
 *      ordinal year, back-computed from the college's current session.
 *   2. the code carries a year (R23 / R2023 / 23) -> batches for every
 *      intake from that adoption year through the current intake year.
 *   3. neither -> one batch per ordinal year 1..durationYears as of the
 *      current session (mirrors the old "offered for every year" default
 *      for the cohorts currently in the pipeline).
 *
 * Entries that already have a `regulationBatches[code]` for a code are left
 * untouched; a code missing one is filled in alongside them.
 *
 * Usage: node scripts/backfill-regulation-batches.mjs                 (dry run, all colleges)
 *        node scripts/backfill-regulation-batches.mjs --apply
 *        node scripts/backfill-regulation-batches.mjs --apply --college "TEST COLLEGE"
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

// --- mirrors src/lib/college/academicSession.ts ---
function currentAcademicStartYear() {
  const d = new Date();
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}
function parseAcademicYearStart(label) {
  const m = /^(\d{4})\s*-\s*(\d{2}|\d{4})$/.exec((label ?? "").trim());
  return m && Number.isFinite(Number(m[1])) ? Number(m[1]) : undefined;
}
function admissionStartYearForCourseYear(asOfStartYear, courseYear) {
  return asOfStartYear - courseYear + 1;
}
function deriveBatch(admissionStartYear, durationYears) {
  return `${admissionStartYear}-${admissionStartYear + durationYears}`;
}

/** "R23" -> 2023, "R2023" -> 2023, "23" -> 2023, "R20" -> 2020. undefined if no plausible year. */
function adoptionYearFromCode(code) {
  const m = String(code ?? "").match(/(\d{2,4})/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (m[1].length === 4) return n >= 1990 && n <= 2100 ? n : undefined;
  if (m[1].length === 2) return 2000 + n;
  return n >= 1990 && n <= 2100 ? n : undefined; // 3-digit: unusual, take as-is if sane
}

async function run() {
  const collegesSnap = await db.collection("colleges").get();
  let totalCoursesTouched = 0;
  let totalCodesFilled = 0;
  let totalCoursesOk = 0;

  for (const collegeDoc of collegesSnap.docs) {
    const collegeName = collegeDoc.data().name ?? "?";
    if (COLLEGE_FILTER && collegeName.trim().toLowerCase() !== COLLEGE_FILTER.trim().toLowerCase()) continue;

    const collegeRef = collegeDoc.ref;
    const [catalogSnap, sessionsSnap] = await Promise.all([
      collegeRef.collection("courseCatalog").get(),
      collegeRef.collection("academicSessions").where("isCurrent", "==", true).get(),
    ]);

    let sessionStart = currentAcademicStartYear();
    if (sessionsSnap.size === 1) {
      const parsed = parseAcademicYearStart(sessionsSnap.docs[0].data().label);
      if (parsed != null) sessionStart = parsed;
    }

    const candidates = catalogSnap.docs.filter((d) => {
      const x = d.data();
      const regs = Array.isArray(x.regulations) ? x.regulations.filter(Boolean) : [];
      const batches = x.regulationBatches ?? {};
      return regs.length > 0 && regs.some((r) => !batches[r]);
    });
    if (candidates.length === 0) continue;

    console.log(`\n=== College ${collegeDoc.id} (${collegeName}) - current session intake year ${sessionStart} ===`);

    const batch = db.batch();
    let batchHasWrites = false;

    for (const d of candidates) {
      const x = d.data();
      const durationYears = Number(x.durationYears);
      if (!Number.isFinite(durationYears) || durationYears < 1) {
        console.log(`  SKIP  "${x.name}" (${x.code}): no valid durationYears`);
        continue;
      }
      const regs = x.regulations.filter(Boolean);
      const existing = { ...(x.regulationBatches ?? {}) };
      const legacyYears = x.regulationYears ?? {};
      const nextBatches = { ...existing };
      const notes = [];

      for (const code of regs) {
        if (existing[code]) continue;

        const listedYears = Array.isArray(legacyYears[code]) ? legacyYears[code].filter((y) => Number.isInteger(y) && y >= 1) : [];
        let starts;
        let strategy;
        if (listedYears.length > 0) {
          starts = listedYears.map((y) => admissionStartYearForCourseYear(sessionStart, y));
          strategy = `regulationYears [${listedYears.join(",")}]`;
        } else {
          const adopted = adoptionYearFromCode(code);
          if (adopted != null) {
            const firstIntake = Math.min(adopted, sessionStart);
            starts = [];
            for (let y = firstIntake; y <= sessionStart && starts.length < 12; y++) starts.push(y);
            strategy = `code year ${adopted}`;
          } else {
            starts = Array.from({ length: durationYears }, (_, i) => admissionStartYearForCourseYear(sessionStart, i + 1));
            strategy = `every ordinal year 1..${durationYears}`;
          }
        }
        const uniqSorted = Array.from(new Set(starts)).sort((a, b) => a - b);
        nextBatches[code] = uniqSorted.map((s) => deriveBatch(s, durationYears)).join(",");
        notes.push(`${code} -> "${nextBatches[code]}"  [${strategy}]`);
        totalCodesFilled++;
      }

      if (notes.length === 0) { totalCoursesOk++; continue; }
      totalCoursesTouched++;
      console.log(`  ${APPLY ? "WRITE" : "PLAN "} "${x.name}" (${x.code}, ${durationYears}y):`);
      for (const n of notes) console.log(`          ${n}`);

      if (APPLY) {
        batch.update(d.ref, { regulationBatches: nextBatches, updatedAt: new Date() });
        batchHasWrites = true;
      }
    }

    if (APPLY && batchHasWrites) await batch.commit();
  }

  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN (pass --apply to write)"}`);
  console.log(`  catalog entries updated: ${totalCoursesTouched}`);
  console.log(`  regulation codes filled: ${totalCodesFilled}`);
  console.log(`  catalog entries already complete: ${totalCoursesOk}`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
