/**
 * Read-only diagnostic: for every college, every department, every Course
 * under it, report whether Department.courseScopes[course.catalogId] already
 * exists, and if not, what it would resolve to today via the flat fallback
 * (department.assignedYears intersected with 1..course.durationYears, plus
 * department.secondaryDepartments). Companion to
 * scripts/backfill-course-scopes.mjs, which writes exactly what this reports.
 *
 * Also flags courses with no catalogId (legacy, pre-catalog courses) - these
 * can't get a courseScopes entry (it's keyed by catalogId) and need manual
 * handling.
 *
 * Usage: node scripts/diagnose-course-scopes.mjs
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
const arr = (v) => (Array.isArray(v) && v.length ? `[${v.join(", ")}]` : "-");

async function run() {
  const collegesSnap = await db.collection("colleges").get();

  let totalCourses = 0;
  let totalMissing = 0;
  let totalLegacy = 0;

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

    let printedHeader = false;
    const printHeader = () => {
      if (printedHeader) return;
      console.log(`\n=== College ${collegeDoc.id} (${collegeDoc.data().name ?? "?"}) ===`);
      printedHeader = true;
    };

    for (const dept of deptById.values()) {
      const courses = coursesByDept.get(dept.id) ?? [];
      if (courses.length === 0) continue;

      for (const course of courses) {
        totalCourses++;
        if (!course.catalogId) {
          totalLegacy++;
          printHeader();
          console.log(
            `  ${dept.name} / ${course.name} (${course.id})  LEGACY - no catalogId, can't be migrated automatically`
          );
          continue;
        }

        const existing = dept.courseScopes?.[course.catalogId];
        if (existing) continue; // already has an explicit override - nothing to do

        totalMissing++;
        const flatYears = dept.assignedYears ?? [];
        const resolvedYears = flatYears.filter((y) => y >= 1 && y <= (course.durationYears ?? 0));
        const secondary = dept.secondaryDepartments ?? [];
        printHeader();
        console.log(
          `  ${dept.name} / ${course.name} (${course.id}, catalogId=${course.catalogId})` +
            `\n      would backfill: assignedYears=${arr(resolvedYears)}  secondaryDepartments=${arr(secondary)}` +
            `\n      (department flat assignedYears=${arr(flatYears)}, course durationYears=${course.durationYears})`
        );
      }
    }
  }

  console.log(
    `\nTotals: ${totalCourses} course(s) checked, ${totalMissing} missing an override (would be backfilled), ` +
      `${totalLegacy} legacy course(s) with no catalogId (need manual handling).`
  );
  console.log("Done (read-only). Run scripts/backfill-course-scopes.mjs to write the missing overrides.");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
