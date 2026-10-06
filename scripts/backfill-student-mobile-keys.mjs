/**
 * Brings EXISTING students under the Student Mobile No rule (see src/lib/students/studentMobile.ts): Student Mobile No
 * is required and unique across ALL students of ALL colleges, held by a claim document studentMobileKeys/{10-digit
 * number} (one global collection, like the roll registry studentUsernames). New adds, imports and edits claim
 * automatically; students saved before that rule have no claim document yet, so this creates one for each.
 *
 * It NEVER changes a student document - only creates claim documents - and it:
 *   1. REPORTS (never touches) every number held by 2+ students - in one college or across colleges - and every
 *      student with no mobile / a stored value that is not a valid 10-digit mobile (e.g. "Optional; phone/text", a
 *      landline). Those need a person to decide; they are skipped.
 *   2. creates the missing claim for each number held by exactly ONE student. An existing claim is never overwritten.
 *
 * Scans every college (collisions across colleges are only found when it is NOT restricted with --college, so run it
 * without --college at least once before relying on global uniqueness).
 *
 * DRY RUN by default; --apply writes (after saving a backup). Idempotent.
 *
 * Usage:
 *   node scripts/backfill-student-mobile-keys.mjs [--college=<collegeId>] [--apply]
 */
import { init, parseArgs, writeBackup, banner } from "./lib/scriptKit.mjs";

const { apply, opt } = parseArgs();
const onlyCollege = opt("college");
const { db } = init();
banner(apply);

// Same rules as normalizeStudentMobile / studentMobileProblem in src/lib/students/studentMobile.ts.
const normalize = (raw) => {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
};
const VALID = /^[6-9]\d{9}$/;

const colleges = onlyCollege ? [db.collection("colleges").doc(onlyCollege)] : (await db.collection("colleges").get()).docs.map((d) => d.ref);
const byNumber = new Map(); // 10 digits -> [{ college, id, name, roll }]
let invalid = 0, noMobile = 0, scanned = 0;

for (const college of colleges) {
  const snap = await college.collection("students").select("name", "rollNumber", "mobileNo").get();
  scanned += snap.size;
  for (const d of snap.docs) {
    const s = d.data();
    if (!String(s.mobileNo ?? "").trim()) {
      noMobile++;
      console.log(`   [${college.id}] no Student Mobile No (required now - fill it in): ${d.id} ${JSON.stringify(s.name)}`);
      continue;
    }
    const key = normalize(s.mobileNo);
    if (!VALID.test(key)) {
      invalid++;
      console.log(`   [${college.id}] not a valid 10-digit mobile - left alone: ${d.id} ${JSON.stringify(s.name)} = ${JSON.stringify(s.mobileNo)}`);
      continue;
    }
    byNumber.set(key, [...(byNumber.get(key) ?? []), { college: college.id, id: d.id, name: s.name, roll: s.rollNumber }]);
  }
}

const toCreate = [];
let dupGroups = 0, crossCollege = 0, alreadyClaimed = 0, claimedByOther = 0;
for (const [key, holders] of byNumber) {
  if (holders.length > 1) {
    dupGroups++;
    if (new Set(holders.map((h) => h.college)).size > 1) crossCollege++;
    console.log(`   ${key} is held by ${holders.length} students - needs a decision, skipped: ${holders.map((h) => `${h.college}/${h.name} (${h.roll || "no roll"}, ${h.id})`).join(" | ")}`);
    continue;
  }
  const [h] = holders;
  const ref = db.collection("studentMobileKeys").doc(key);
  const existing = await ref.get();
  if (existing.exists) {
    if (existing.get("studentId") === h.id && existing.get("collegeId") === h.college) alreadyClaimed++;
    else { claimedByOther++; console.log(`   claim ${key} already points at another student (${existing.get("collegeId")}/${existing.get("studentId")}) - skipped ${h.college}/${h.id}`); }
    continue;
  }
  toCreate.push({ ref, college: h.college, studentId: h.id, key });
}

console.log(`\nStudents scanned: ${scanned}`);
console.log(`With NO mobile (reported, left alone): ${noMobile}`);
console.log(`Invalid / non-mobile values (reported, left alone): ${invalid}`);
console.log(`Numbers shared by 2+ students (reported, skipped): ${dupGroups} (${crossCollege} across different colleges)`);
console.log(`Claims already correct: ${alreadyClaimed}; pointing at someone else (skipped): ${claimedByOther}`);
console.log(`Claims to create: ${toCreate.length}`);

if (!apply) {
  console.log("\nDry run complete - nothing written.");
  process.exit(0);
}

const file = writeBackup("backfill-student-mobile-keys", toCreate.map((x) => ({ path: x.ref.path, before: null })));
console.log(`Backup written: ${file}`);

let batch = db.batch();
let n = 0;
for (const c of toCreate) {
  batch.set(c.ref, { studentId: c.studentId, collegeId: c.college, reservedAt: new Date(), backfilled: true });
  if (++n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
}
if (n) await batch.commit();
console.log("Applied.");
