/**
 * Read-only diagnostic: for every college, compare the Principal's
 * courseCatalog (colleges/{id}/courseCatalog) against the per-department
 * `courses` collection. Flags:
 *   - department Course docs with no catalogId, or a catalogId that no
 *     longer resolves to an existing catalog entry (legacy, pre-catalog data)
 *   - two Course docs in the same department whose catalogId differs but
 *     whose names normalize to the same thing (duplicate/typo, e.g.
 *     "Bachelor of Technology" vs "Bachelors of Technology")
 * Reads only - writes nothing.
 *
 * Usage: node scripts/diagnose-course-catalog-duplicates.mjs
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

function normalize(name) {
  return (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/s\b/g, "") // "bachelors" -> "bachelor", "colleges" -> "college"
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function run() {
  const collegesSnap = await db.collection("colleges").get();

  for (const collegeDoc of collegesSnap.docs) {
    const collegeRef = collegeDoc.ref;
    const [catalogSnap, coursesSnap, deptsSnap, sectionsSnap] = await Promise.all([
      collegeRef.collection("courseCatalog").get(),
      collegeRef.collection("courses").get(),
      collegeRef.collection("departments").get(),
      collegeRef.collection("sections").get(),
    ]);

    if (coursesSnap.empty) continue;

    const deptNameById = new Map(deptsSnap.docs.map((d) => [d.id, d.data().name ?? d.id]));
    const catalogById = new Map(catalogSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));

    console.log(`\n=== College ${collegeDoc.id} (${collegeDoc.data().name ?? "?"}) ===`);
    console.log(`-- courseCatalog (${catalogSnap.size}) --`);
    for (const d of catalogSnap.docs) {
      const x = d.data();
      console.log(`  id=${d.id}  name="${x.name}"  code=${x.code}  years=${x.durationYears}  active=${x.isActive}`);
    }

    console.log(`-- courses (${coursesSnap.size}) --`);
    const sectionCountByCourseId = new Map();
    for (const s of sectionsSnap.docs) {
      const cid = s.data().courseId;
      sectionCountByCourseId.set(cid, (sectionCountByCourseId.get(cid) ?? 0) + 1);
    }

    const rows = coursesSnap.docs.map((d) => {
      const x = d.data();
      const catalog = x.catalogId ? catalogById.get(x.catalogId) : undefined;
      return {
        id: d.id,
        deptId: x.departmentId,
        deptName: deptNameById.get(x.departmentId) ?? x.departmentId,
        name: x.name,
        code: x.code,
        catalogId: x.catalogId ?? null,
        catalogResolved: !!catalog,
        sections: sectionCountByCourseId.get(d.id) ?? 0,
      };
    });

    for (const r of rows) {
      const flag = !r.catalogId
        ? "  <-- NO catalogId (legacy/free-typed)"
        : !r.catalogResolved
        ? "  <-- catalogId does not resolve to an existing catalog entry"
        : "";
      console.log(
        `  dept=${r.deptName}  name="${r.name}"  code=${r.code}  catalogId=${r.catalogId ?? "-"}  sections=${r.sections}${flag}`
      );
    }

    // Group by department + normalized name to surface duplicates/typos.
    console.log(`-- possible duplicates (same department, same normalized name, different course doc) --`);
    const byDeptNormName = new Map();
    for (const r of rows) {
      const key = `${r.deptId}::${normalize(r.name)}`;
      const list = byDeptNormName.get(key) ?? [];
      list.push(r);
      byDeptNormName.set(key, list);
    }
    let anyDupes = false;
    for (const [, list] of byDeptNormName) {
      if (list.length < 2) continue;
      anyDupes = true;
      console.log(`  ${list[0].deptName} - "${list[0].name}" (normalized) has ${list.length} course docs:`);
      for (const r of list) {
        console.log(`      id=${r.id}  name="${r.name}"  catalogId=${r.catalogId ?? "-"}  sections=${r.sections}`);
      }
    }
    if (!anyDupes) console.log("  (none)");
  }

  console.log("\nDone (read-only).");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
