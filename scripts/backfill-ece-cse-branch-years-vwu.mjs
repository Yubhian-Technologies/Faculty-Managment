/**
 * One-time fix for VISHNU WOMEN'S UNIVERSITY (college c3a1195c049c44ca9945):
 * "ELECTRONICS ENGINEERING [VLSI DESIGN & TECHNOLOGY]" (cddfetitVzFKCzaMrbTU, child of
 * ELECTRONICS & COMMUNICATION ENGINEERING) and "CSE [CYBER SECURITY]" (H4lOcoaqROi3DwuQLevo,
 * child of COMPUTER SCIENCE AND ENGINEERING) are real CHILD branches but carry no
 * Department.courseScopes of their own, so Year 1 is filtered out of their direct
 * "Add/Import Students" picker (isValidYear1LandingDepartment's departmentClaimsYearItself
 * escape hatch - see src/lib/college/academicStructure.ts). Year 1 already works via
 * Department="BASIC SCIENCE - MATHS" + Core Department=<branch>; this additionally opens it
 * directly on the branch, the same shape "COMPUTER SCIENCE AND ENGINEERING" (their own parent)
 * already has for this catalogId.
 *
 * Exact same root cause and fix as scripts/backfill-ai-branch-years-vwu.mjs (AIML/AIDS branches
 * under ARTIFICIAL INTELLIGENCE) - just two different branches reported later.
 *
 * DRY RUN by default; --apply writes, after saving a JSON backup (backups/, git-ignored).
 * Idempotent: running it again after --apply finds nothing left to do.
 *
 *   node scripts/backfill-ece-cse-branch-years-vwu.mjs           -> dry run
 *   node scripts/backfill-ece-cse-branch-years-vwu.mjs --apply
 */
import { init, parseArgs, writeBackup, banner } from "./lib/scriptKit.mjs";

const { apply } = parseArgs();
const { db } = init();
banner(apply);

const COLLEGE_ID = "c3a1195c049c44ca9945";
const CATALOG_ID = "dnpJOUfTa7MF1BMHUsIt"; // Bachelor of Technology
// branch department id -> its own parent's department id (for the duration check below)
const BRANCHES = {
  cddfetitVzFKCzaMrbTU: "zqUVjq9ubwPAtmsD7dHz", // ELECTRONICS ENGINEERING [VLSI DESIGN & TECHNOLOGY] <- ECE
  H4lOcoaqROi3DwuQLevo: "BGTbQ55j2y8Re8c6MJHb", // CSE [CYBER SECURITY] <- CSE
};
const YEARS = [1, 2, 3, 4];

const deptColl = db.collection("colleges").doc(COLLEGE_ID).collection("departments");
const coursesColl = db.collection("colleges").doc(COLLEGE_ID).collection("courses");

const toWrite = [];
for (const [id, parentId] of Object.entries(BRANCHES)) {
  const snap = await deptColl.doc(id).get();
  if (!snap.exists) { console.error(`Department ${id} not found - skipping`); continue; }
  const dept = snap.data();

  // Duration check (mirrors the route): the branch owns no Course doc of its own for this
  // catalogId, so - same fallback the route itself applies - check its parent's.
  const parentCourse = await coursesColl.where("departmentId", "==", parentId).where("catalogId", "==", CATALOG_ID).limit(1).get();
  const durationYears = parentCourse.empty ? 0 : (parentCourse.docs[0].data().durationYears ?? 0);
  if (YEARS.some((y) => y > durationYears)) {
    console.error(`${dept.name}: refusing - year(s) beyond this course's ${durationYears}-year duration`);
    continue;
  }

  const current = dept.courseScopes?.[CATALOG_ID]?.assignedYears ?? [];
  if (JSON.stringify([...current].sort()) === JSON.stringify(YEARS)) continue; // already correct
  toWrite.push({ ref: snap.ref, name: dept.name, before: dept, secondaryDepartments: dept.courseScopes?.[CATALOG_ID]?.secondaryDepartments ?? dept.secondaryDepartments ?? [] });
}

console.log(`${toWrite.length} department(s) to write`);
for (const w of toWrite) console.log(`    ${w.name}: courseScopes.${CATALOG_ID}.assignedYears -> [${YEARS.join(",")}]`);
if (!apply || toWrite.length === 0) { console.log(apply ? "Nothing to do." : "Dry run - pass --apply to write."); process.exit(0); }

const backup = toWrite.map((w) => ({ path: w.ref.path, before: w.before }));
console.log(`backup: ${writeBackup(`ece-cse-branch-years-${COLLEGE_ID}`, backup)}`);

for (const year of YEARS) {
  const existing = await db.collection("colleges").doc(COLLEGE_ID).collection("academicYears").where("yearNumber", "==", year).limit(1).get();
  if (existing.empty) {
    await db.collection("colleges").doc(COLLEGE_ID).collection("academicYears").add({
      collegeId: COLLEGE_ID, yearNumber: year, label: `${year}${year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th"} Year`,
      isActive: true, createdAt: new Date(), updatedAt: new Date(),
    });
  } else if (existing.docs[0].data().isActive !== true) {
    await existing.docs[0].ref.update({ isActive: true, updatedAt: new Date() });
  }
}

const batch = db.batch();
for (const w of toWrite) {
  batch.update(w.ref, { [`courseScopes.${CATALOG_ID}`]: { assignedYears: YEARS, secondaryDepartments: w.secondaryDepartments } });
}
await batch.commit();
console.log("done.");
