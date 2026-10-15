// Re-point a sub-department's subject assignments at its PARENT's course doc.
//
// A sub-department owns no `courses` doc, so AssignByCodeStep resolves the
// course by falling back to its parent (see src/components/academics/
// AssignByCodeStep.tsx). First-year rows that were moved off the Basic Science
// departments still carry the old Basic Science courseId, so that query finds
// nothing and the Assign tab reads "0 subjects" - while the teaching
// assignments built on those same subjects are still there.
//
// Only `courseId`/`courseName` change. The doc id is {subjectId}_{deptId}_{sem},
// so nothing is re-keyed, re-created or deleted.
//
//   node scripts/fix-subdepartment-course-ids.mjs                 # dry run
//   node scripts/fix-subdepartment-course-ids.mjs --apply         # writes a backup first
//   node scripts/fix-subdepartment-course-ids.mjs --apply --dept "VLSI"
//   node scripts/fix-subdepartment-course-ids.mjs --rollback <backup.json>
//
// --apply writes subdept-courseid-backup-<timestamp>.json next to this script
// BEFORE touching anything: one {docPath, courseId, courseName} per row, as it
// was. --rollback replays that file verbatim, so the restore is exact rather
// than merely deterministic.
import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const COLLEGE = process.env.COLLEGE_ID || "c3a1195c049c44ca9945";
const APPLY = process.argv.includes("--apply");
const arg = (flag) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : null; };
const only = arg("--dept");
const rollbackFile = arg("--rollback");

const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
const privateKey = rawKey.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
if (!getApps().length) initializeApp({ credential: cert({
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey }) });
const db = getFirestore();
const col = db.collection("colleges").doc(COLLEGE);

// Firestore caps a batch at 500; everything here is well under that, so the
// whole change lands in ONE commit - all of it or none of it.
async function commitAll(rows, toUpdate) {
  let batch = db.batch(), n = 0, written = 0;
  for (const r of rows) {
    batch.update(...toUpdate(r));
    if (++n === 400) { await batch.commit(); written += n; batch = db.batch(); n = 0; }
  }
  if (n) { await batch.commit(); written += n; }
  return written;
}

// --- rollback: replay a backup file exactly, then stop ----------------------
if (rollbackFile) {
  const saved = JSON.parse(readFileSync(rollbackFile, "utf8"));
  console.log(`Restoring ${saved.rows.length} rows from ${rollbackFile} (taken ${saved.takenAt})`);
  const done = await commitAll(saved.rows, (r) =>
    [db.doc(r.docPath), { courseId: r.courseId, courseName: r.courseName, updatedAt: new Date() }]);
  console.log(`Restored ${done} rows to their original courseId.`);
  process.exit(0);
}

const deptDocs = (await col.collection("departments").get()).docs;
const dept = Object.fromEntries(deptDocs.map((d) => [d.id, d.data()]));
const courses = (await col.collection("courses").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const ownerOf = (id) => dept[(courses.find((c) => c.id === id) || {}).departmentId]?.name ?? "(unknown)";

const assignments = (await col.collection("subjectSemesterAssignments").get()).docs;
const planned = [];

for (const d of deptDocs) {
  const parentId = d.data().parentDepartmentId;
  if (!parentId) continue;                                   // parents already own their course
  if (only && !d.data().name.toUpperCase().includes(only.toUpperCase())) continue;

  const rows = assignments.filter((a) => a.data().departmentId === d.id);
  if (rows.length === 0) continue;

  // Exactly what the UI does: own course first, then the parent's.
  const catalogIds = [...new Set(rows.map((r) => r.data().courseId))]
    .map((cid) => courses.find((c) => c.id === cid)?.catalogId).filter(Boolean);
  for (const catalogId of [...new Set(catalogIds)]) {
    const target = [d.id, parentId]
      .map((x) => courses.find((c) => c.catalogId === catalogId && c.departmentId === x)).find(Boolean);
    if (!target) { console.log(`!! ${d.data().name}: no course for catalog ${catalogId} - skipped`); continue; }

    // Rows already pointing at the target are left alone - that is how the
    // R23 rows (already correct) stay out of this entirely.
    const wrong = rows.filter((r) => {
      const a = r.data();
      return a.courseId !== target.id && courses.find((c) => c.id === a.courseId)?.catalogId === catalogId;
    });
    if (wrong.length === 0) continue;
    planned.push({ deptName: d.data().name, parentName: dept[parentId]?.name, target, rows: wrong });
  }
}

if (planned.length === 0) { console.log("Nothing to change - every sub-department row already points at its parent's course."); process.exit(0); }

let total = 0;
for (const p of planned) {
  const from = [...new Set(p.rows.map((r) => r.data().courseId))];
  console.log(`\n${p.deptName}   (parent: ${p.parentName})`);
  console.log(`  ${p.rows.length} rows`);
  for (const f of from) console.log(`    from ${f}  (${ownerOf(f)})`);
  console.log(`    to   ${p.target.id}  (${ownerOf(p.target.id)})`);
  for (const r of p.rows.slice(0, 4)) { const a = r.data(); console.log(`      ${String(a.subjectCode).padEnd(12)} y${a.year} s${a.semester}  ${a.subjectName}`); }
  if (p.rows.length > 4) console.log(`      ... +${p.rows.length - 4} more`);
  total += p.rows.length;
}
console.log(`\n${total} rows in total.`);

if (!APPLY) { console.log("\nDRY RUN - nothing was written. Re-run with --apply to make these changes."); process.exit(0); }

// Backup BEFORE the first write, so a crash mid-run is still recoverable.
const flat = planned.flatMap((p) => p.rows.map((r) => ({ ref: r.ref, target: p.target })));
const backup = { takenAt: new Date().toISOString(), collegeId: COLLEGE,
  rows: planned.flatMap((p) => p.rows.map((r) => ({ docPath: r.ref.path, courseId: r.data().courseId, courseName: r.data().courseName ?? null }))) };
const backupPath = fileURLToPath(new URL(`./subdept-courseid-backup-${Date.now()}.json`, import.meta.url));
writeFileSync(backupPath, JSON.stringify(backup, null, 1));
console.log(`\nBackup written: ${backupPath}  (${backup.rows.length} rows)`);

const written = await commitAll(flat, (r) =>
  [r.ref, { courseId: r.target.id, courseName: r.target.name, updatedAt: new Date() }]);
console.log(`\nApplied. ${written} rows updated.`);
console.log(`To undo exactly:  node scripts/fix-subdepartment-course-ids.mjs --rollback "${backupPath}"`);
