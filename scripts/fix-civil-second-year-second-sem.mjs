// Civil R23, II Year II Semester: replace a duplicated copy of III-I with the
// real II-II subjects.
//
// Civil's semester 4 holds UGCE4A0823 (serialNumber 10, correct) followed by
// serialNumbers 11-22, which are a verbatim duplicate of semester 5's twelve
// III-I subjects. The nine real II-II subjects from the course structure are
// assigned nowhere. Semester 3 is correct and is not touched.
//
// Writes are confined to colleges/<id>/subjectSemesterAssignments:
//   - DELETE the 12 duplicate rows in semester 4 (ids end _4; the semester 5
//     copies are separate documents ending _5 and are untouched)
//   - CREATE the 9 missing II-II rows at serialNumber 1-9, leaving UGCE4A0823
//     at 10 exactly as it is
//
// New rows are built field-for-field by the same rules as
// buildSubjectInstancePayload (src/lib/subjects/services/SubjectInstanceService.ts),
// which is the only thing the app itself uses to create these documents. It no
// longer writes universityCode or isCustomized, and neither does this - the
// nine rows created when this was first run predate that and still carry
// isCustomized, exactly like all 1100 rows already in the collection.
//
//   node scripts/fix-civil-second-year-second-sem.mjs             # dry run
//   node scripts/fix-civil-second-year-second-sem.mjs --apply     # writes a backup first
//   node scripts/fix-civil-second-year-second-sem.mjs --rollback <backup.json>
import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const COLLEGE = process.env.COLLEGE_ID || "c3a1195c049c44ca9945";
const APPLY = process.argv.includes("--apply");
const rollbackFile = (() => { const i = process.argv.indexOf("--rollback"); return i > -1 ? process.argv[i + 1] : null; })();

const DEPT = "jKIVmDIEdRtwJhfdY75O";        // CIVIL ENGINEERING
const DEPT_NAME = "CIVIL ENGINEERING";
const COURSE = "kGxb48rxfmDjecjU1S4k";      // Civil's own B.Tech course doc
const REGULATION = "R23";
const YEAR = 2, SEMESTER = 4;

// The II-II subjects, in the order the course structure lists them. UGCE4A0823
// is position 10 and is already assigned, so it is deliberately absent here.
const WANTED = [
  "UGMB4T0123", "UGCE4T0123", "UGCE4T0223", "UGCE4T0323", "UGCE4T0423",
  "UGCE4P0523", "UGCE4P0623", "UGCE4K0723", "UGME4P0623",
];

// The III-I subjects wrongly duplicated into semester 4.
const DUPLICATES = [
  "UGCE5T0123", "UGCE5T0223", "UGCE5T0323", "UGCE5T0423", "UGCE5T0523",
  "UGCE5T0623", "UGMB5T0123", "UGCE5P0723", "UGCE5P0823", "UGCE5K0923",
  "UGCE5P1023", "UGCE5I1123",
];

const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
const privateKey = rawKey.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
if (!getApps().length) initializeApp({ credential: cert({
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey }) });
const db = getFirestore();
const col = db.collection("colleges").doc(COLLEGE);
const instances = col.collection("subjectSemesterAssignments");

// --- rollback: restore deleted docs, remove created ones --------------------
if (rollbackFile) {
  const saved = JSON.parse(readFileSync(rollbackFile, "utf8"));
  const batch = db.batch();
  for (const d of saved.deleted) batch.set(db.doc(d.docPath), d.data);
  for (const id of saved.created) batch.delete(instances.doc(id));
  await batch.commit();
  console.log(`Rolled back: restored ${saved.deleted.length} deleted rows, removed ${saved.created.length} created rows.`);
  process.exit(0);
}

// Mirrors buildSubjectInstancePayload - same fields, same conditional spreads.
function buildPayload(master, subjectId, serialNumber, now) {
  const lectureHours = master.lectureHours ?? 0;
  const tutorialHours = master.tutorialHours ?? 0;
  const practicalHours = master.practicalHours ?? 0;
  return {
    id: `${subjectId}_${DEPT}_${SEMESTER}`,
    collegeId: COLLEGE,
    subjectId,
    masterSubjectId: subjectId,
    subjectName: master.name ?? "",
    subjectCode: master.code ?? "",
    serialNumber,
    ...(master.shortCode ? { shortCode: master.shortCode } : {}),
    courseId: COURSE,
    courseName: master.courseName ?? "",
    academicYear: master.academicYear ?? "",
    regulation: master.regulation ?? "",
    year: YEAR,
    departmentId: DEPT,
    departmentName: DEPT_NAME,
    semester: SEMESTER,
    type: master.type ?? "THEORY",
    ...(master.category ? { category: master.category } : {}),
    ...(master.customCategory ? { customCategory: master.customCategory } : {}),
    lectureHours,
    tutorialHours,
    practicalHours,
    hoursPerWeek: lectureHours + tutorialHours + practicalHours,
    totalHoursPerSemester: master.totalHoursPerSemester ?? null,
    credits: master.credits ?? 0,
    ...(master.internalMarks != null ? { internalMarks: master.internalMarks } : {}),
    ...(master.externalMarks != null ? { externalMarks: master.externalMarks } : {}),
    ...(master.totalMarks != null ? { totalMarks: master.totalMarks } : {}),
    ...(master.isCustom ? { isCustom: master.isCustom } : {}),
    ...(master.isNonTeachingLoad ? { isNonTeachingLoad: master.isNonTeachingLoad } : {}),
    ...(master.excludeFromResume ? { excludeFromResume: master.excludeFromResume } : {}),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

const masters = (await col.collection("subjects").get()).docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((s) => (s.regulation ?? "").trim() === REGULATION);
const existing = (await instances.where("departmentId", "==", DEPT).get()).docs
  .filter((d) => d.data().regulation === REGULATION && d.data().semester === SEMESTER);

// --- safety gate: nothing may depend on the rows being removed --------------
const toDelete = existing.filter((d) => DUPLICATES.includes(String(d.data().subjectCode)));
const deleteSubjectIds = toDelete.map((d) => d.data().subjectId);
const liveTeaching = (await col.collection("teachingAssignments").where("departmentId", "==", DEPT).get()).docs
  .map((d) => d.data())
  .filter((t) => !t.isPast && deleteSubjectIds.includes(t.subjectId));
if (liveTeaching.length > 0) {
  console.log(`REFUSED: ${liveTeaching.length} live teaching assignment(s) depend on rows this would delete:`);
  for (const t of liveTeaching) console.log(`  ${t.subjectCode}  ${t.facultyName ?? "?"}`);
  process.exit(1);
}

// --- plan -------------------------------------------------------------------
const now = new Date();
const creates = [];
for (let i = 0; i < WANTED.length; i++) {
  const code = WANTED[i];
  const match = masters.filter((m) => String(m.code).toUpperCase() === code);
  if (match.length !== 1) { console.log(`REFUSED: ${code} matched ${match.length} master subjects, expected exactly 1.`); process.exit(1); }
  const master = match[0];
  const id = `${master.id}_${DEPT}_${SEMESTER}`;
  if (existing.some((d) => d.id === id)) { console.log(`  (${code} already assigned - skipped)`); continue; }
  creates.push({ id, code, payload: buildPayload(master, master.id, i + 1, now) });
}

console.log(`Civil ${DEPT_NAME} - R23, Year ${YEAR}, Semester ${SEMESTER}\n`);
console.log(`DELETE ${toDelete.length} duplicated III-I rows:`);
for (const d of toDelete) console.log(`   sn=${String(d.data().serialNumber ?? "-").padStart(3)}  ${String(d.data().subjectCode).padEnd(12)} ${d.data().subjectName}`);
console.log(`\nCREATE ${creates.length} II-II rows:`);
let credits = 0;
for (const c of creates) {
  const p = c.payload;
  console.log(`   sn=${String(p.serialNumber).padStart(3)}  ${String(p.subjectCode).padEnd(12)} ${String(p.lectureHours)}-${p.tutorialHours}-${p.practicalHours}-${p.credits}  ${p.subjectName}`);
  credits += Number(p.credits) || 0;
}
const keeping = existing.filter((d) => !DUPLICATES.includes(String(d.data().subjectCode)));
console.log(`\nKEEPING ${keeping.length} row(s) already correct:`);
for (const d of keeping) console.log(`   sn=${String(d.data().serialNumber ?? "-").padStart(3)}  ${String(d.data().subjectCode).padEnd(12)} ${d.data().subjectName}`);
const keptCredits = keeping.reduce((n, d) => n + (Number(d.data().credits) || 0), 0);
// Count what is already there too, or a re-run with nothing left to create reports 0.
console.log(`
Semester 4 will hold ${keeping.length + creates.length} rows, ${credits + keptCredits} credits (the course structure says 21).`);

if (!APPLY) { console.log("\nDRY RUN - nothing was written. Re-run with --apply to make these changes."); process.exit(0); }

const backup = { takenAt: new Date().toISOString(), collegeId: COLLEGE,
  deleted: toDelete.map((d) => ({ docPath: d.ref.path, data: d.data() })),
  created: creates.map((c) => c.id) };
const backupPath = fileURLToPath(new URL(`./civil-sem4-backup-${Date.now()}.json`, import.meta.url));
writeFileSync(backupPath, JSON.stringify(backup, null, 1));
console.log(`\nBackup written: ${backupPath}  (${backup.deleted.length} deleted rows captured in full)`);

const batch = db.batch();
for (const d of toDelete) batch.delete(d.ref);
for (const c of creates) batch.set(instances.doc(c.id), c.payload);
await batch.commit();
console.log(`\nApplied. ${toDelete.length} deleted, ${creates.length} created - one atomic batch.`);
console.log(`To undo exactly:  node scripts/fix-civil-second-year-second-sem.mjs --rollback "${backupPath}"`);
