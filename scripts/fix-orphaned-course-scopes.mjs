/**
 * Targeted fix: for every college, every department, every
 * Department.courseScopes[catalogId] entry - delete it if NO live Course doc
 * exists for that exact (departmentId, catalogId) pair.
 *
 * Root cause: adding a course seeds courseScopes[catalogId] from the
 * department's flat secondaryDepartments (courses/route.ts POST), but
 * deleting a course never cleared that entry back out (courses/[id]/route.ts
 * DELETE - now fixed to clean up on delete going forward). Any course that
 * was ever added and later deleted before that fix left its courseScopes
 * entry behind - invisible in the Department page's own UI (which only shows
 * scopes with a live Course doc) but still live in every scope-resolution
 * code path (fedYears, resolveDepartmentCourseScope), so it keeps granting
 * cross-listing/feed access for a catalog programme the department no longer
 * even offers.
 *
 * Prints each orphaned entry's old value before removing it, so the change is
 * reviewable and reversible (the printed value can be restored manually via
 * Firestore console if ever needed).
 *
 * Usage: node scripts/fix-orphaned-course-scopes.mjs           (dry run - prints only)
 *        node scripts/fix-orphaned-course-scopes.mjs --apply   (writes the change)
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");

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
  let totalOrphans = 0;

  for (const collegeDoc of collegesSnap.docs) {
    const ref = collegeDoc.ref;
    const [deptsSnap, coursesSnap] = await Promise.all([
      ref.collection("departments").get(),
      ref.collection("courses").get(),
    ]);

    const liveCourseKeys = new Set(
      coursesSnap.docs.map((d) => `${d.data().departmentId}::${d.data().catalogId}`)
    );

    const collegeOrphans = [];
    for (const d of deptsSnap.docs) {
      const scopes = d.data().courseScopes;
      if (!scopes) continue;
      for (const [catalogId, scope] of Object.entries(scopes)) {
        const key = `${d.id}::${catalogId}`;
        if (!liveCourseKeys.has(key)) {
          collegeOrphans.push({ deptRef: d.ref, deptName: d.data().name, catalogId, scope });
        }
      }
    }

    if (collegeOrphans.length === 0) continue;

    console.log(`\nCollege ${collegeDoc.id} (${collegeDoc.data().name}) - ${collegeOrphans.length} orphaned courseScopes entr${collegeOrphans.length === 1 ? "y" : "ies"}:`);
    for (const o of collegeOrphans) {
      totalOrphans++;
      console.log(
        `  ${o.deptName}.courseScopes.${o.catalogId} = ${JSON.stringify(o.scope)}` +
        `\n      (no live Course doc for departmentId=${o.deptRef.id}, catalogId=${o.catalogId})`
      );
      if (APPLY) {
        await o.deptRef.update({ [`courseScopes.${o.catalogId}`]: FieldValue.delete(), updatedAt: new Date() });
      }
    }
  }

  console.log(`\n${APPLY ? "Applied" : "Dry run - pass --apply to write"}. ${totalOrphans} orphaned entr${totalOrphans === 1 ? "y" : "ies"} found across all colleges.`);
}

run().catch((e) => { console.error(e); process.exit(1); });
