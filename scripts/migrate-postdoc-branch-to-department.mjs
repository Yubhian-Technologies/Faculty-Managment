/**
 * Postdoctoral Fellowship Details now ask for "Name of the Department" (stored as departmentName, the same key Ph.D. uses)
 * instead of Branch. This copies an existing Postdoctoral entry's Branch into departmentName so the value is stored under
 * the new field as well as shown through the form's fallback.
 *
 * COPY, never move: `branch`, `course` and every other key stay exactly as they are. Only an entry that HAS a branch and has
 * NO departmentName yet is touched, so re-running it changes nothing (idempotent).
 *
 * Covers both places a profile lives: colleges/{id}/facultyMembers/{id} and, for HOD / Principal / Vice Principal,
 * colleges/{id}/users/{uid} (their own academicProfile).
 *
 * Usage:
 *   node scripts/migrate-postdoc-branch-to-department.mjs                 -> DRY RUN (writes nothing, saves no backup)
 *   node scripts/migrate-postdoc-branch-to-department.mjs --apply         -> backs up the touched entries first, then writes
 *   node scripts/migrate-postdoc-branch-to-department.mjs --college=<id>  -> one college only (works with --apply too)
 */
import { init, parseArgs, writeBackup, banner } from "./lib/scriptKit.mjs";

const { apply, opt } = parseArgs();
const onlyCollege = opt("college");
const { db } = init();
banner(apply);

const text = (v) => (typeof v === "string" ? v.trim() : "");
const KEY = "postdoctoralFellowshipDetails";

const colleges = onlyCollege ? [db.collection("colleges").doc(onlyCollege)] : (await db.collection("colleges").get()).docs.map((d) => d.ref);
const plan = []; // { ref, path, label, branch, before }
const legacyKey = [];
let scanned = 0, withPostdoc = 0, alreadyDone = 0, noBranch = 0;

for (const college of colleges) {
  for (const coll of ["facultyMembers", "users"]) {
    const snap = await college.collection(coll).select("academicProfile", "employeeId", "name", "legalName").get();
    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data();
      const ap = data.academicProfile ?? {};
      if (ap.postDoctoralDetails && !ap[KEY]) legacyKey.push(`${coll}/${doc.id}`); // still on the pre-rename key: reported, not touched
      const pd = ap[KEY];
      if (!pd || typeof pd !== "object") continue;
      withPostdoc++;
      const branch = text(pd.branch);
      if (!branch) { noBranch++; continue; }
      if (text(pd.departmentName)) { alreadyDone++; continue; }
      plan.push({
        ref: doc.ref,
        path: `${college.path}/${coll}/${doc.id}`,
        label: `${data.employeeId ?? doc.id} ${data.legalName ?? data.name ?? ""}`.trim(),
        branch,
        before: pd,
      });
    }
  }
}

console.log(`Scanned ${scanned} profile documents; ${withPostdoc} have a Postdoctoral entry.`);
console.log(`  already has a department: ${alreadyDone} | no branch to copy: ${noBranch} | to change: ${plan.length}`);
if (legacyKey.length) console.log(`  NOTE: ${legacyKey.length} still use the old key postDoctoralDetails (left untouched): ${legacyKey.join(", ")}`);
for (const p of plan) console.log(`  - ${p.label}\n      ${p.path}\n      departmentName <- "${p.branch}" (branch and course stay as they are)`);

if (!plan.length) { console.log("\nNothing to do."); process.exit(0); }
if (!apply) { console.log("\nDry run only - nothing was written. Re-run with --apply to write (a backup of these entries is saved first)."); process.exit(0); }

const file = writeBackup("postdoc-branch-to-department", plan.map((p) => ({ path: p.path, field: `academicProfile.${KEY}`, before: p.before })));
console.log(`\nBackup written: ${file}`);
for (const p of plan) {
  // A dotted-path update touches ONLY this one key; every other key of the entry and of academicProfile is left alone.
  await p.ref.update({ [`academicProfile.${KEY}.departmentName`]: p.branch });
}
console.log(`Updated ${plan.length} entr${plan.length === 1 ? "y" : "ies"}.`);
