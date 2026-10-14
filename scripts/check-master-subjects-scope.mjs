/**
 * READ-ONLY DIAGNOSTIC. For a given college + course name + regulation, lists
 * every Course doc sharing that name (one per department that runs it),
 * groups them by catalogId, and reports how many master subjects
 * (colleges/{id}/subjects) exist per courseId for that regulation.
 *
 * Why it exists: the Course Structure "Import Subjects" page scopes a
 * department's view to ONE specific Course doc, not the whole catalog group -
 * so subjects imported under a sibling department's own copy of the same
 * course can be invisible from another department's picker, looking like
 * "nothing imported" when it actually exists elsewhere in the master
 * collection. This never writes anything.
 *
 * Usage:
 *   node scripts/check-master-subjects-scope.mjs --college=VIT --course="Bachelor of Technology" --regulation=R26
 */
import { init, parseArgs } from "./lib/scriptKit.mjs";

const { opt } = parseArgs();
const collegeTerm = opt("college");
const courseName = opt("course");
const regulation = opt("regulation");
if (!collegeTerm || !courseName || !regulation) {
  console.error('Usage: node scripts/check-master-subjects-scope.mjs --college=<name or id> --course="<name>" --regulation=<reg>');
  process.exit(1);
}
const { db } = init();

async function resolveCollege(term) {
  const direct = await db.collection("colleges").doc(term).get();
  if (direct.exists) return { id: direct.id, ...direct.data() };
  const snap = await db.collection("colleges").get();
  const needle = term.toLowerCase();
  const exact = snap.docs.filter((d) => (d.data().name ?? "").toLowerCase() === needle);
  const matches = exact.length ? exact : snap.docs.filter((d) => (d.data().name ?? "").toLowerCase().includes(needle));
  if (matches.length === 1) return { id: matches[0].id, ...matches[0].data() };
  if (matches.length === 0) throw new Error(`No college found matching "${term}"`);
  throw new Error(`Multiple colleges match "${term}": ${matches.map((d) => `${d.id} (${d.data().name})`).join(", ")}`);
}

const college = await resolveCollege(collegeTerm);
console.log(`College: ${college.name} (${college.id})\n`);
const collegeRef = db.collection("colleges").doc(college.id);

const [coursesSnap, deptsSnap] = await Promise.all([
  collegeRef.collection("courses").get(),
  collegeRef.collection("departments").get(),
]);
const deptNameById = new Map(deptsSnap.docs.map((d) => [d.id, d.data().name ?? d.id]));

const needle = courseName.trim().toLowerCase();
const matchingCourses = coursesSnap.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((c) => (c.name ?? "").trim().toLowerCase() === needle);

if (matchingCourses.length === 0) {
  console.log(`No Course doc named "${courseName}" found at all.`);
  process.exit(0);
}

const byCatalog = new Map();
for (const c of matchingCourses) {
  const key = c.catalogId ?? `(no catalogId):${c.id}`;
  if (!byCatalog.has(key)) byCatalog.set(key, []);
  byCatalog.get(key).push(c);
}

console.log(`Found ${matchingCourses.length} Course doc(s) named "${courseName}", in ${byCatalog.size} catalog group(s):\n`);

for (const [catalogId, courses] of byCatalog) {
  console.log(`Catalog group: ${catalogId}`);
  for (const c of courses) {
    const deptName = deptNameById.get(c.departmentId) ?? c.departmentId;
    const subjSnap = await collegeRef.collection("subjects").where("courseId", "==", c.id).get();
    const total = subjSnap.size;
    const forRegulation = subjSnap.docs.filter((d) => (d.data().regulation ?? "").trim() === regulation).length;
    console.log(`  - ${String(deptName).padEnd(24)} courseId=${c.id}  subjects(any regulation)=${total}  subjects(${regulation})=${forRegulation}`);
  }
  console.log("");
}

console.log("Done. Nothing was written.");
