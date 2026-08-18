/**
 * Read-only diagnostic: for every college, finds every department that still
 * carries a non-empty flat Department.assignedYears - a leftover from before
 * "Years Taught" was removed from the Add/Edit Department forms (years are
 * now decided per-course, at course creation - see courses/new). Reports,
 * per department:
 *   - its courses (if any), flagging whether one is a Bachelor of Technology
 *     (by catalog code "BTECH" or name match)
 *   - whether that BTech course already has its own courseScopes override
 *   - whether the college's course catalog even HAS a Bachelor of Technology
 *     entry to attach a new Course doc to, for a department with no courses
 *     at all
 *
 * Categorizes each affected department as:
 *   HAS_BTECH        - has a BTech course; attach flat years to its override
 *   NO_COURSES       - has no course at all; would need a new BTech Course
 *                       doc created (only possible if the college's catalog
 *                       has a BTech entry)
 *   HAS_COURSES_NO_BTECH - has course(s), none of them BTech; ambiguous,
 *                       needs a human decision, not auto-migrated
 *
 * Usage: node scripts/diagnose-legacy-flat-years.mjs
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
const normalizeCode = (code) => (code ?? "").toUpperCase().replace(/[^A-Z]/g, "");
const isBtech = (c) => normalizeCode(c.code) === "BTECH" || /bachelor'?s?\s+of\s+technology/i.test(c.name ?? "");

async function run() {
  const collegesSnap = await db.collection("colleges").get();

  const totals = { HAS_BTECH: 0, NO_COURSES: 0, HAS_COURSES_NO_BTECH: 0 };

  for (const collegeDoc of collegesSnap.docs) {
    const collegeRef = collegeDoc.ref;
    const [deptsSnap, coursesSnap, catalogSnap] = await Promise.all([
      collegeRef.collection("departments").get(),
      collegeRef.collection("courses").get(),
      collegeRef.collection("courseCatalog").get(),
    ]);

    const affected = deptsSnap.docs.filter((d) => (d.data().assignedYears ?? []).length > 0);
    if (affected.length === 0) continue;

    const coursesByDept = new Map();
    for (const c of coursesSnap.docs) {
      const x = { id: c.id, ...c.data() };
      if (!coursesByDept.has(x.departmentId)) coursesByDept.set(x.departmentId, []);
      coursesByDept.get(x.departmentId).push(x);
    }
    const btechCatalogItem = catalogSnap.docs.map((d) => ({ id: d.id, ...d.data() })).find(isBtech);

    console.log(`\n=== College ${collegeDoc.id} (${collegeDoc.data().name ?? "?"}) ===`);
    console.log(`College catalog has BTech entry: ${btechCatalogItem ? `yes (${btechCatalogItem.id})` : "NO"}`);

    for (const d of affected) {
      const dept = d.data();
      const courses = coursesByDept.get(d.id) ?? [];
      const btechCourse = courses.find(isBtech);

      let category;
      if (btechCourse) category = "HAS_BTECH";
      else if (courses.length === 0) category = "NO_COURSES";
      else category = "HAS_COURSES_NO_BTECH";
      totals[category]++;

      console.log(
        `  ${dept.name}  [${category}]` +
          `\n      flat assignedYears=${arr(dept.assignedYears)}` +
          `\n      courses=${courses.length === 0 ? "none" : courses.map((c) => `${c.name}(${c.code})`).join(", ")}` +
          (btechCourse
            ? `\n      BTech course id=${btechCourse.id}, catalogId=${btechCourse.catalogId}, existing override=${dept.courseScopes?.[btechCourse.catalogId] ? JSON.stringify(dept.courseScopes[btechCourse.catalogId]) : "none"}`
            : category === "NO_COURSES"
              ? `\n      would create BTech course from catalog item ${btechCatalogItem ? btechCatalogItem.id : "MISSING - cannot migrate"}`
              : "")
      );
    }
  }

  console.log(`\nTotals: HAS_BTECH=${totals.HAS_BTECH}  NO_COURSES=${totals.NO_COURSES}  HAS_COURSES_NO_BTECH=${totals.HAS_COURSES_NO_BTECH}`);
  console.log("Done (read-only).");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
