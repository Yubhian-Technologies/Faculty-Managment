/**
 * Brings existing students under the GLOBAL roll-number registry
 * (studentUsernames/{KEY}, see src/lib/students/rollIdentity.ts). Roll numbers are
 * unique across ALL colleges, compared after normalisation (letters and digits only,
 * case-insensitive), so this scans every college and:
 *
 *   1. REPORTS (never changes) every normalised roll held by 2+ students - in one
 *      college or across colleges. Those need a person to decide; they are skipped
 *      by every write below until fixed (fix a roll, re-run).
 *   2. stamps students.rollNumberUpper on documents that predate it;
 *   3. with --sync-registry, creates the missing registry entry for each roll held by
 *      exactly ONE student, carrying their login (uid + loginEmail) when they have
 *      one. An existing registry entry is never overwritten.
 *
 * DRY RUN by default; --apply writes (after saving a backup). Idempotent. Restrict to
 * one college with --college=<id> (collisions are then only found within it, so run
 * it WITHOUT --college at least once before relying on global uniqueness).
 *
 * Usage:
 *   node scripts/backfill-student-roll-keys.mjs [--college=<collegeId>] [--sync-registry] [--apply]
 */
import { init, parseArgs, writeBackup, banner } from "./lib/scriptKit.mjs";

const { apply, opt, flag } = parseArgs();
const onlyCollege = opt("college");
const syncRegistry = flag("sync-registry");
const { db } = init();
banner(apply);

const upperOf = (roll) => (typeof roll === "string" ? roll.trim().toUpperCase() : "");
const rollKey = (roll) => String(roll ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const snap = onlyCollege
  ? await db.collection("colleges").doc(onlyCollege).collection("students").get()
  : await db.collectionGroup("students").get();
// A collection group also matches other collections named "students"; keep only colleges/{id}/students/{id}.
const docs = snap.docs.filter((d) => /^colleges\/[^/]+\/students\/[^/]+$/.test(d.ref.path));
console.log(`Students scanned: ${docs.length}${onlyCollege ? ` (college ${onlyCollege} only)` : " (all colleges)"}`);

const collegeOf = (d) => d.ref.path.split("/")[1];
const holders = new Map(); // normalised key -> [{ doc, college }]
const stamp = [];
let noRoll = 0;
for (const d of docs) {
  const s = d.data();
  const key = rollKey(s.rollNumber);
  if (!key) { noRoll++; continue; }
  holders.set(key, [...(holders.get(key) ?? []), { doc: d, college: collegeOf(d) }]);
  const upper = upperOf(s.rollNumber);
  if (s.rollNumberUpper !== upper) stamp.push({ ref: d.ref, path: d.ref.path, before: s.rollNumberUpper ?? null, after: upper });
}
console.log(`Students with no usable roll number (left alone): ${noRoll}`);
console.log(`To stamp rollNumberUpper: ${stamp.length}`);

const collisions = [...holders.entries()].filter(([, v]) => v.length > 1);
const crossCollege = collisions.filter(([, v]) => new Set(v.map((x) => x.college)).size > 1);
console.log(`\nNormalised rolls held by 2+ students: ${collisions.length} (${crossCollege.length} across different colleges)`);
for (const [key, v] of collisions.slice(0, 40)) {
  console.log(`   ${key}: ${v.map((x) => `${x.college}/${x.doc.id}="${x.doc.data().rollNumber}"${x.doc.data().uid ? " [has login]" : ""}`).join("  |  ")}`);
}
if (collisions.length > 40) console.log(`   ... and ${collisions.length - 40} more`);
if (collisions.length > 0) console.log("   -> these need a decision (give one of them a different roll, or archive a duplicate). Nothing below touches them.");

// Registry entries to create (unambiguous rolls only).
const toCreate = [];
let alreadyRegistered = 0;
let registryConflicts = 0;
if (syncRegistry) {
  for (const [key, v] of holders) {
    if (v.length !== 1) continue;
    const { doc, college } = v[0];
    const s = doc.data();
    const ref = db.collection("studentUsernames").doc(key.toUpperCase());
    const existing = await ref.get();
    if (existing.exists) {
      const e = existing.data();
      const mine = (e.collegeId === college && e.studentDocId === doc.id) || (!e.studentDocId && s.uid && e.uid === s.uid);
      if (mine) alreadyRegistered++;
      else if (e.active !== false) { registryConflicts++; console.log(`   registry entry ${ref.id} is held by someone else (${e.collegeId ?? "legacy"}/${e.studentDocId ?? "?"}) - skipped ${college}/${doc.id}`); }
      else toCreate.push({ ref, college, doc, s, key, replaces: e });
      continue;
    }
    toCreate.push({ ref, college, doc, s, key, replaces: null });
  }
  console.log(`\nRegistry entries to create: ${toCreate.length}; already correct: ${alreadyRegistered}; conflicting (skipped): ${registryConflicts}`);
} else {
  console.log("\n(re-run with --sync-registry to also create the missing registry entries)");
}

if (!apply) {
  console.log("\nDry run complete - nothing written.");
  process.exit(0);
}

const file = writeBackup("backfill-student-roll-keys", [
  ...stamp.map((x) => ({ path: x.path, field: "rollNumberUpper", before: x.before })),
  ...toCreate.map((x) => ({ path: x.ref.path, before: x.replaces })),
]);
console.log(`Backup written: ${file}`);

let batch = db.batch();
let n = 0;
const flush = async () => {
  if (n) { await batch.commit(); batch = db.batch(); n = 0; }
};
for (const x of stamp) {
  batch.update(x.ref, { rollNumberUpper: x.after });
  if (++n >= 400) await flush();
}
for (const c of toCreate) {
  const now = new Date();
  batch.set(c.ref, {
    rollKey: c.key,
    rollNumber: String(c.s.rollNumber).trim(),
    rollNumberUpper: upperOf(c.s.rollNumber),
    collegeId: c.college,
    studentDocId: c.doc.id,
    name: c.s.name ?? "",
    active: true,
    createdAt: now,
    backfilledAt: now,
    ...(c.s.uid && c.s.loginEmail ? { uid: c.s.uid, loginEmail: c.s.loginEmail } : {}),
  });
  if (++n >= 400) await flush();
}
await flush();
console.log("Applied.");
