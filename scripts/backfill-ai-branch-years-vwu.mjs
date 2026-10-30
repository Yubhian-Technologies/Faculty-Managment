/**
 * One-time fix for VISHNU WOMEN'S UNIVERSITY (college c3a1195c049c44ca9945):
 * "CSE [ARTIFICIAL INTELLIGENCE & MACHINE LEARNING]" (SNZIAiro7ww3jQ5kqfMK) and
 * "CSE [ARTIFICIAL INTELLIGENCE & DATA SCIENCE]" (jZNonS5ktRMm9rD9prqh) are real
 * CHILD branches of the "ARTIFICIAL INTELLIGENCE" container but carry no
 * Department.courseScopes of their own, so Year 1 is filtered out of their
 * direct "Add/Import Students" picker (isValidYear1LandingDepartment's
 * departmentClaimsYearItself escape hatch - see src/lib/college/academicStructure.ts).
 * Year 1 already works via Department="BASIC SCIENCE - MATHS" + Core
 * Department=<branch>; this additionally opens it directly on the branch,
 * the same way "COMPUTER SCIENCE AND ENGINEERING" already has its own
 * courseScopes.<catalogId>.assignedYears including 1 despite also being fed
 * by "BASIC SCIENCE - ENGLISH" for Year 1.
 *
 * Mirrors the courseScope branch of PATCH /api/college/departments
 * (src/app/api/college/departments/route.ts) for this narrow, addition-only
 * case: duration check + ensureAcademicYear. checkYearsEdit (yearDependents.ts)
 * only refuses when an edit LOSES a year a department could previously admit;
 * adding years 1-4 to a department that previously resolved [2,3,4] via parent
 * fallback cannot lose anything, so it is skipped here (same conclusion the
 * route's guard would reach).
 *
 * DRY RUN by default; --apply writes, after saving a JSON backup (backups/, git-ignored).
 * Idempotent: running it again after --apply finds nothing left to do.
 *
 *   node scripts/backfill-ai-branch-years-vwu.mjs           -> dry run
 *   node scripts/backfill-ai-branch-years-vwu.mjs --apply
 */
import { init, parseArgs, writeBackup, banner } from "./lib/scriptKit.mjs";

const { apply } = parseArgs();
const { db } = init();
banner(apply);

const COLLEGE_ID = "c3a1195c049c44ca9945";
const CATALOG_ID = "dnpJOUfTa7MF1BMHUsIt"; // Bachelor of Technology
const BRANCH_IDS = ["SNZIAiro7ww3jQ5kqfMK", "jZNonS5ktRMm9rD9prqh"];
const YEARS = [1, 2, 3, 4];

const deptColl = db.collection("colleges").doc(COLLEGE_ID).collection("departments");
const coursesColl = db.collection("colleges").doc(COLLEGE_ID).collection("courses");

// Duration check (mirrors the route): neither branch owns its own Course doc
// for this catalogId, so - same fallback the route itself applies - check the
// parent's.
const parentCourse = await coursesColl.where("departmentId", "==", "hYLHc2eAZ826zvRG6gcp").where("catalogId", "==", CATALOG_ID).limit(1).get();
const durationYears = parentCourse.empty ? 0 : (parentCourse.docs[0].data().durationYears ?? 0);
if (YEARS.some((y) => y > durationYears)) {
  console.error(`Refusing: year(s) beyond this course's ${durationYears}-year duration`);
  process.exit(1);
}

const toWrite = [];
for (const id of BRANCH_IDS) {
  const snap = await deptColl.doc(id).get();
  if (!snap.exists) { console.error(`Department ${id} not found - skipping`); continue; }
  const dept = snap.data();
  const current = dept.courseScopes?.[CATALOG_ID]?.assignedYears ?? [];
  if (JSON.stringify([...current].sort()) === JSON.stringify(YEARS)) continue; // already correct
  toWrite.push({ ref: snap.ref, name: dept.name, before: dept, secondaryDepartments: dept.courseScopes?.[CATALOG_ID]?.secondaryDepartments ?? dept.secondaryDepartments ?? [] });
}

console.log(`${toWrite.length} department(s) to write`);
for (const w of toWrite) console.log(`    ${w.name}: courseScopes.${CATALOG_ID}.assignedYears -> [${YEARS.join(",")}]`);
if (!apply || toWrite.length === 0) { console.log(apply ? "Nothing to do." : "Dry run - pass --apply to write."); process.exit(0); }

const backup = toWrite.map((w) => ({ path: w.ref.path, before: w.before }));
console.log(`backup: ${writeBackup(`ai-branch-years-${COLLEGE_ID}`, backup)}`);

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
