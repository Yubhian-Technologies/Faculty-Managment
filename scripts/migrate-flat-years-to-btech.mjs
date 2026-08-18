/**
 * One-time migration, scoped to SHRI VISHNU ENGINEERING COLLEGE FOR WOMEN and
 * VISHNU INSTITUTE OF TECHNOLOGY only (the two colleges confirmed for this
 * run - see scripts/diagnose-legacy-flat-years.mjs for the full picture
 * across every college, including the ones deliberately left out here).
 *
 * For every department in those two colleges that still carries a non-empty
 * flat Department.assignedYears (a leftover from before "Years Taught" was
 * removed from the Add/Edit Department forms):
 *   - If it already has a Bachelor of Technology course WITH a catalogId and
 *     an existing courseScopes override matching the flat value (already
 *     true for every such department here, thanks to the earlier
 *     backfill-course-scopes.mjs run) - just clears the now-redundant flat
 *     assignedYears field. No new write to courseScopes needed.
 *   - If it has no course at all - creates a new BTech Course doc (from the
 *     college's own existing "Bachelor of Technology" catalog entry - never
 *     invents a new catalog item), writes a courseScopes override for it
 *     using the department's current flat assignedYears (intersected with
 *     the catalog item's durationYears) AND flat secondaryDepartments
 *     (carried over verbatim, so any existing cross-listing relationship
 *     that depended on the flat fallback keeps working unchanged), then
 *     clears the flat assignedYears field.
 *
 * Departments with a BTech course that has no catalogId (pre-catalog legacy
 * row - no key to attach an override to) are left completely untouched, not
 * migrated - reported separately so they can be handled by hand.
 *
 * Dry-run by default - prints a report and writes nothing. Pass --apply to write.
 *
 * Usage:
 *   node scripts/migrate-flat-years-to-btech.mjs
 *   node scripts/migrate-flat-years-to-btech.mjs --apply
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

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
const APPLY = process.argv.includes("--apply");
const arr = (v) => (Array.isArray(v) && v.length ? `[${v.join(", ")}]` : "-");
const normalizeCode = (code) => (code ?? "").toUpperCase().replace(/[^A-Z]/g, "");
const isBtech = (c) => normalizeCode(c.code) === "BTECH" || /bachelor'?s?\s+of\s+technology/i.test(c.name ?? "");

const COLLEGE_IDS = [
  "6df56a45a69244238ca0", // SHRI VISHNU ENGINEERING COLLEGE FOR WOMEN
  "bc77d03b57194edeb006", // VISHNU INSTITUTE OF TECHNOLOGY
];

async function run() {
  let totalCleared = 0;
  let totalCreated = 0;
  let totalUntouched = 0;

  for (const collegeId of COLLEGE_IDS) {
    const collegeRef = db.collection("colleges").doc(collegeId);
    const collegeSnap = await collegeRef.get();
    if (!collegeSnap.exists) {
      console.log(`\n=== College ${collegeId} not found - skipping ===`);
      continue;
    }

    const [deptsSnap, coursesSnap, catalogSnap] = await Promise.all([
      collegeRef.collection("departments").get(),
      collegeRef.collection("courses").get(),
      collegeRef.collection("courseCatalog").get(),
    ]);

    const affected = deptsSnap.docs.filter((d) => (d.data().assignedYears ?? []).length > 0);
    console.log(`\n=== College ${collegeId} (${collegeSnap.data().name ?? "?"}) - ${affected.length} affected department(s) ===`);
    if (affected.length === 0) continue;

    const coursesByDept = new Map();
    for (const c of coursesSnap.docs) {
      const x = { id: c.id, ...c.data() };
      if (!coursesByDept.has(x.departmentId)) coursesByDept.set(x.departmentId, []);
      coursesByDept.get(x.departmentId).push(x);
    }
    const btechCatalogItem = catalogSnap.docs.map((d) => ({ id: d.id, ...d.data() })).find(isBtech);
    if (!btechCatalogItem) {
      console.log("  No BTech catalog entry - nothing can be migrated in this college.");
      continue;
    }

    const batch = db.batch();
    let batchHasWrites = false;

    for (const d of affected) {
      const dept = d.data();
      const courses = coursesByDept.get(d.id) ?? [];
      const btechCourse = courses.find(isBtech);

      if (btechCourse && !btechCourse.catalogId) {
        console.log(`  ${dept.name}: BTech course has no catalogId (legacy) - UNTOUCHED, needs manual handling`);
        totalUntouched++;
        continue;
      }

      if (btechCourse) {
        const existingOverride = dept.courseScopes?.[btechCourse.catalogId];
        console.log(
          `  ${dept.name}: has BTech course, override=${existingOverride ? JSON.stringify(existingOverride) : "MISSING"} - ` +
          `clearing flat assignedYears=${arr(dept.assignedYears)}` +
          (existingOverride ? "" : "  <-- WARNING: no override exists, will set one from flat before clearing")
        );
        if (APPLY) {
          batchHasWrites = true;
          const updates = {};
          if (!existingOverride) {
            const years = (dept.assignedYears ?? []).filter((y) => y >= 1 && y <= (btechCourse.durationYears ?? 0));
            updates[`courseScopes.${btechCourse.catalogId}`] = { assignedYears: years, secondaryDepartments: dept.secondaryDepartments ?? [] };
          }
          batch.update(d.ref, { ...updates, assignedYears: FieldValue.delete(), updatedAt: new Date() });
        }
        totalCleared++;
        continue;
      }

      // No course at all - create one from the college's own BTech catalog entry.
      const years = (dept.assignedYears ?? []).filter((y) => y >= 1 && y <= (btechCatalogItem.durationYears ?? 0));
      const secondary = dept.secondaryDepartments ?? [];
      console.log(
        `  ${dept.name}: creating BTech course from catalog ${btechCatalogItem.id}, ` +
        `courseScopes.${btechCatalogItem.id} = { assignedYears: ${arr(years)}, secondaryDepartments: ${arr(secondary)} }, clearing flat assignedYears`
      );
      if (APPLY) {
        batchHasWrites = true;
        const now = new Date();
        const courseRef = collegeRef.collection("courses").doc();
        batch.set(courseRef, {
          collegeId,
          departmentId: d.id,
          catalogId: btechCatalogItem.id,
          name: btechCatalogItem.name,
          code: btechCatalogItem.code,
          durationYears: Number(btechCatalogItem.durationYears),
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        batch.update(d.ref, {
          [`courseScopes.${btechCatalogItem.id}`]: { assignedYears: years, secondaryDepartments: secondary },
          assignedYears: FieldValue.delete(),
          updatedAt: now,
        });
      }
      totalCreated++;
    }

    if (APPLY && batchHasWrites) {
      await batch.commit();
      console.log("  Committed.");
    }
  }

  console.log(`\nTotals: cleared-only=${totalCleared}  created-course=${totalCreated}  untouched(legacy)=${totalUntouched}`);
  if (!APPLY) console.log("\nDry run only - re-run with --apply to write these changes.");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
