/**
 * One-time backfill: gives every Course an explicit
 * Department.courseScopes[course.catalogId] entry, freezing exactly what it
 * resolves to TODAY via the flat fallback (department.assignedYears
 * intersected with 1..course.durationYears, plus department.secondaryDepartments)
 * as an explicit override. This makes removing the flat "Years Taught" UI
 * from the Add/Edit Department forms a no-op for every existing course - the
 * per-course override becomes the sole routing source without changing any
 * currently-resolved behavior.
 *
 * Courses with no catalogId (legacy, pre-catalog) are skipped - they can't
 * get a keyed override; see scripts/diagnose-course-scopes.mjs to find them.
 *
 * Dry-run by default - prints a report and writes nothing. Pass --apply to write.
 *
 * Usage:
 *   node scripts/backfill-course-scopes.mjs
 *   node scripts/backfill-course-scopes.mjs --apply
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

async function run() {
  const collegesSnap = await db.collection("colleges").get();
  let totalWritten = 0;
  let totalLegacySkipped = 0;

  for (const collegeDoc of collegesSnap.docs) {
    const collegeRef = collegeDoc.ref;
    const [deptsSnap, coursesSnap] = await Promise.all([
      collegeRef.collection("departments").get(),
      collegeRef.collection("courses").get(),
    ]);
    if (coursesSnap.empty) continue;

    const deptById = new Map(deptsSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    const coursesByDept = new Map();
    for (const c of coursesSnap.docs) {
      const x = { id: c.id, ...c.data() };
      if (!coursesByDept.has(x.departmentId)) coursesByDept.set(x.departmentId, []);
      coursesByDept.get(x.departmentId).push(x);
    }

    // Per-department patch: courseScopes.<catalogId> = { assignedYears, secondaryDepartments }
    // for every course under it that's missing one. Written as a single
    // update per department (not per course) so concurrent catalogIds on the
    // same department don't overwrite each other's dot-path writes.
    const deptPatches = new Map();
    const report = [];

    for (const dept of deptById.values()) {
      const courses = coursesByDept.get(dept.id) ?? [];
      for (const course of courses) {
        if (!course.catalogId) {
          totalLegacySkipped++;
          continue;
        }
        if (dept.courseScopes?.[course.catalogId]) continue; // already has an override

        const flatYears = dept.assignedYears ?? [];
        const resolvedYears = flatYears.filter((y) => y >= 1 && y <= (course.durationYears ?? 0));
        const secondary = dept.secondaryDepartments ?? [];

        if (!deptPatches.has(dept.id)) deptPatches.set(dept.id, {});
        deptPatches.get(dept.id)[`courseScopes.${course.catalogId}`] = {
          assignedYears: resolvedYears,
          secondaryDepartments: secondary,
        };
        report.push(
          `  ${dept.name} / ${course.name}: courseScopes.${course.catalogId} = ` +
            `{ assignedYears: ${arr(resolvedYears)}, secondaryDepartments: ${arr(secondary)} }`
        );
      }
    }

    if (deptPatches.size === 0) continue;

    console.log(`\n=== College ${collegeDoc.id} (${collegeDoc.data().name ?? "?"}) ===`);
    for (const line of report) console.log(line);

    if (APPLY) {
      const batch = db.batch();
      const now = new Date();
      for (const [deptId, patch] of deptPatches) {
        batch.update(collegeRef.collection("departments").doc(deptId), { ...patch, updatedAt: now });
      }
      await batch.commit();
      totalWritten += report.length;
      console.log(`  Wrote ${report.length} override(s).`);
    }
  }

  if (totalLegacySkipped > 0) {
    console.log(`\nSkipped ${totalLegacySkipped} legacy course(s) with no catalogId (need manual handling).`);
  }
  if (APPLY) {
    console.log(`\nWrote ${totalWritten} course override(s) total across all colleges.`);
  } else {
    console.log("\nDry run only - re-run with --apply to write these changes.");
  }
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
