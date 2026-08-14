/**
 * Reconciles per-department `courses` docs against the Principal's
 * courseCatalog, for every college that has at least one catalog entry.
 *
 * Root cause: courses created before the Course Catalog feature existed (or
 * anything else that slipped in without going through it) carry a free-typed
 * `name`/`code` and no `catalogId`. buildCourseGroups() (src/lib/departments/
 * hodScope.ts) groups by catalogId, falling back to normalized name only for
 * those - so a legacy "Bachelor of Technology" (no catalogId) and a properly
 * catalog-linked "Bachelor of Technology" (has catalogId) land in two
 * different groups and render as two identical-looking tabs; a legacy
 * "Bachelors of Technology" typo renders as a third.
 *
 * For each course doc without a catalogId that resolves to a real catalog
 * entry, this:
 *   1. Tries to match it to exactly one catalog entry, by normalized code
 *      then normalized name (only when there's no ambiguity).
 *   2. If its department already has another course doc pointing at that same
 *      catalog entry, MERGES into it: every section and courseYearTimings row
 *      pointing at the legacy doc's id is repointed to the survivor's id, then
 *      the legacy doc is deleted.
 *   3. Otherwise, backfills catalogId + canonical name/code/durationYears onto
 *      the legacy doc in place (its id, and everything referencing it, is
 *      unchanged).
 * Course docs referencing a department that no longer exists AND have zero
 * sections/timings are deleted outright as dead data, regardless of whether a
 * catalog match exists.
 * Already-catalog-linked docs get their name/code/durationYears refreshed
 * from the catalog too (cosmetic - covers a doc created before a later rename
 * whose cached fields drifted from the catalog).
 * Unmatched/ambiguous docs are left untouched and reported.
 *
 * Usage: node scripts/fix-course-catalog-duplicates.mjs                  (dry run)
 *        node scripts/fix-course-catalog-duplicates.mjs --apply          (all colleges with a catalog)
 *        node scripts/fix-course-catalog-duplicates.mjs --apply --college "TEST COLLEGE"
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

const normalizeName = (name) =>
  (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeCode = (code) => (code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function run() {
  const collegesSnap = await db.collection("colleges").get();
  let totalBackfilled = 0;
  let totalMerged = 0;
  let totalDeleted = 0;
  let totalRefreshed = 0;

  for (const collegeDoc of collegesSnap.docs) {
    const collegeName = collegeDoc.data().name ?? "?";
    if (COLLEGE_FILTER && collegeName.trim().toLowerCase() !== COLLEGE_FILTER.trim().toLowerCase()) continue;

    const collegeRef = collegeDoc.ref;
    const [catalogSnap, coursesSnap, deptsSnap, sectionsSnap, timingsSnap] = await Promise.all([
      collegeRef.collection("courseCatalog").get(),
      collegeRef.collection("courses").get(),
      collegeRef.collection("departments").get(),
      collegeRef.collection("sections").get(),
      collegeRef.collection("courseYearTimings").get(),
    ]);

    if (catalogSnap.empty || coursesSnap.empty) continue;

    console.log(`\n=== College ${collegeDoc.id} (${collegeName}) ===`);

    const existingDeptIds = new Set(deptsSnap.docs.map((d) => d.id));
    const catalog = catalogSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const catalogById = new Map(catalog.map((c) => [c.id, c]));

    const sectionsByCourseId = new Map();
    for (const s of sectionsSnap.docs) {
      const cid = s.data().courseId;
      const list = sectionsByCourseId.get(cid) ?? [];
      list.push(s.ref);
      sectionsByCourseId.set(cid, list);
    }
    const timingsByCourseId = new Map();
    for (const t of timingsSnap.docs) {
      const cid = t.data().courseId;
      const list = timingsByCourseId.get(cid) ?? [];
      list.push(t.ref);
      timingsByCourseId.set(cid, list);
    }

    // Effective catalogId per course doc after this pass, per department, to
    // detect a merge before any writes happen.
    const survivorByDeptCatalog = new Map(); // `${departmentId}::${catalogId}` -> course doc id (survivor)

    // Seed with docs that already resolve cleanly - they're always the
    // preferred survivor over a newly-matched legacy doc.
    for (const d of coursesSnap.docs) {
      const x = d.data();
      if (x.catalogId && catalogById.has(x.catalogId)) {
        survivorByDeptCatalog.set(`${x.departmentId}::${x.catalogId}`, d.id);
      }
    }

    const batch = db.batch();
    let batchHasWrites = false;

    for (const d of coursesSnap.docs) {
      const x = d.data();
      const deptExists = existingDeptIds.has(x.departmentId);
      const sectionRefs = sectionsByCourseId.get(d.id) ?? [];
      const timingRefs = timingsByCourseId.get(d.id) ?? [];
      const inUse = sectionRefs.length > 0 || timingRefs.length > 0;

      const alreadyValid = x.catalogId && catalogById.has(x.catalogId);

      if (alreadyValid) {
        const c = catalogById.get(x.catalogId);
        if (x.name !== c.name || x.code !== c.code || x.durationYears !== c.durationYears) {
          console.log(`  [refresh] dept=${x.departmentId} course=${d.id} "${x.name}" -> "${c.name}" (${c.code}, ${c.durationYears}y)`);
          totalRefreshed++;
          if (APPLY) {
            batch.update(d.ref, { name: c.name, code: c.code, durationYears: c.durationYears, updatedAt: new Date() });
            batchHasWrites = true;
          }
        }
        continue;
      }

      // Dead data: department no longer exists and nothing references this course.
      if (!deptExists && !inUse) {
        console.log(`  [delete-dead] dept=${x.departmentId} (deleted) course=${d.id} "${x.name}" - no sections/timings, department no longer exists`);
        totalDeleted++;
        if (APPLY) {
          batch.delete(d.ref);
          batchHasWrites = true;
        }
        continue;
      }

      // Try to resolve against the catalog: exact normalized code, then
      // normalized name - only when exactly one candidate matches.
      const codeKey = normalizeCode(x.code);
      const nameKey = normalizeName(x.name);
      let candidates = catalog.filter((c) => normalizeCode(c.code) === codeKey);
      if (candidates.length !== 1) candidates = catalog.filter((c) => normalizeName(c.name) === nameKey);

      if (candidates.length !== 1) {
        console.log(`  [unresolved] dept=${x.departmentId} course=${d.id} "${x.name}" (${x.code}) - no unambiguous catalog match, left as-is`);
        continue;
      }

      const match = candidates[0];
      const survivorKey = `${x.departmentId}::${match.id}`;
      const survivorId = survivorByDeptCatalog.get(survivorKey);

      if (survivorId && survivorId !== d.id) {
        console.log(
          `  [merge] dept=${x.departmentId} "${x.name}" (${d.id}) -> "${match.name}" (${survivorId}) - repointing ${sectionRefs.length} section(s), ${timingRefs.length} timing(s), then deleting ${d.id}`
        );
        totalMerged++;
        if (APPLY) {
          for (const ref of sectionRefs) batch.update(ref, { courseId: survivorId, updatedAt: new Date() });
          for (const ref of timingRefs) batch.update(ref, { courseId: survivorId, updatedAt: new Date() });
          batch.delete(d.ref);
          batchHasWrites = true;
        }
        continue;
      }

      console.log(`  [backfill] dept=${x.departmentId} course=${d.id} "${x.name}" (${x.code}) -> catalogId=${match.id} "${match.name}" (${match.code}, ${match.durationYears}y)`);
      totalBackfilled++;
      survivorByDeptCatalog.set(survivorKey, d.id);
      if (APPLY) {
        batch.update(d.ref, {
          catalogId: match.id,
          name: match.name,
          code: match.code,
          durationYears: match.durationYears,
          updatedAt: new Date(),
        });
        batchHasWrites = true;
      }
    }

    if (APPLY && batchHasWrites) await batch.commit();
  }

  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN (pass --apply to write)"}`);
  console.log(`  backfilled catalogId: ${totalBackfilled}`);
  console.log(`  merged duplicates: ${totalMerged}`);
  console.log(`  deleted dead docs: ${totalDeleted}`);
  console.log(`  refreshed cosmetic drift: ${totalRefreshed}`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
