/**
 * Sets ONLY facultyMembers.aicteFacultyId (plus updatedAt) for the given
 * employeeIds, restricted to ONE college. DRY RUN by default; --apply writes.
 *
 * Safety rules (an ID that breaks any of them is skipped, never guessed):
 *   - employeeId must match exactly one doc, in the target college
 *   - any doc with that employeeId in ANOTHER college -> STOP that ID
 *   - not found anywhere / only a case-different match -> skipped
 *   - same employeeId listed twice in the input -> skipped (ambiguous)
 *   - value must look like the AICTE ID format "1-<digits>"
 *   - an existing different non-empty value is reported as OVERWRITE
 *
 * Usage:
 *   node scripts/set-faculty-aicte-id.mjs --college=<collegeId> --file=<ids.txt> [--apply]
 *   node scripts/set-faculty-aicte-id.mjs --college=<collegeId> [--apply] EMP1=VAL1 EMP2=VAL2
 * The file has one "EMPLOYEE_ID=AICTE_ID" per line.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}
const db = getFirestore();

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const collegeId = opt("college");
const file = opt("file");
const rawPairs = [
  ...(file ? readFileSync(file, "utf8").split(/\r?\n/) : []),
  ...args.filter((a) => !a.startsWith("--")),
].map((l) => l.trim()).filter(Boolean);

if (!collegeId || rawPairs.length === 0) {
  console.error("Usage: node scripts/set-faculty-aicte-id.mjs --college=<collegeId> (--file=<ids.txt> | EMP=VAL ...) [--apply]");
  process.exit(1);
}

const AICTE_FORMAT = /^1-\d{6,12}$/;

async function run() {
  console.log(`Firebase project: ${process.env.FIREBASE_ADMIN_PROJECT_ID}`);
  const collegeSnap = await db.collection("colleges").doc(collegeId).get();
  if (!collegeSnap.exists) { console.error(`College ${collegeId} not found`); process.exit(1); }
  console.log(`Target college: ${collegeSnap.data().name} (${collegeId})`);
  console.log(apply ? "MODE: APPLY (writing)\n" : "MODE: DRY RUN (no writes)\n");

  // Parse input
  const entries = rawPairs.map((l) => {
    const i = l.indexOf("=");
    return { line: l, empId: i > 0 ? l.slice(0, i).trim() : l, value: i > 0 ? l.slice(i + 1).trim() : "" };
  });
  const seen = new Map();
  for (const e of entries) seen.set(e.empId, (seen.get(e.empId) ?? 0) + 1);

  // Every faculty doc in every college, light fields only
  const all = await db.collectionGroup("facultyMembers")
    .select("employeeId", "legalName", "department", "aicteFacultyId").get();
  const byExact = new Map();
  const byLower = new Map();
  for (const d of all.docs) {
    const id = d.data().employeeId;
    if (typeof id !== "string" || !id) continue;
    byExact.set(id, [...(byExact.get(id) ?? []), d]);
    byLower.set(id.toLowerCase(), [...(byLower.get(id.toLowerCase()) ?? []), d]);
  }
  const collegeOf = (d) => d.ref.parent.parent.id;

  const plan = [];
  const problems = [];
  let noChange = 0;
  for (const e of entries) {
    const skip = (why) => problems.push(`${e.empId}: ${why}`);
    if (!e.empId || !e.value) { skip(`malformed line "${e.line}"`); continue; }
    if (seen.get(e.empId) > 1) { skip("listed more than once in the input - skipped"); continue; }
    if (!AICTE_FORMAT.test(e.value)) { skip(`AICTE ID "${e.value}" is not in the expected 1-<digits> format - skipped`); continue; }

    const exact = byExact.get(e.empId) ?? [];
    const other = exact.filter((d) => collegeOf(d) !== collegeId);
    if (other.length) {
      skip(`STOPPED - found in another college (${other.map((d) => collegeOf(d)).join(", ")}) ${exact.length > other.length ? "(also in target college)" : ""}`);
      continue;
    }
    if (exact.length === 0) {
      const near = byLower.get(e.empId.toLowerCase()) ?? [];
      skip(near.length ? `no exact match; only a different-case match "${near[0].data().employeeId}" - skipped` : "NOT FOUND in any college - skipped");
      continue;
    }
    if (exact.length > 1) { skip(`${exact.length} docs match in the target college - skipped (ambiguous)`); continue; }

    const doc = exact[0];
    const cur = typeof doc.data().aicteFacultyId === "string" ? doc.data().aicteFacultyId : "";
    if (cur === e.value) { noChange++; continue; }
    if (cur && args.includes("--no-overwrite")) { skip(`already has a different AICTE ID ${cur} (new: ${e.value}) - left untouched`); continue; }
    plan.push({ ref: doc.ref, empId: e.empId, name: doc.data().legalName ?? "(no name)", dept: doc.data().department ?? "-", cur, value: e.value });
  }

  // Same AICTE ID given to two different people is a red flag
  const byValue = new Map();
  for (const p of plan) byValue.set(p.value, [...(byValue.get(p.value) ?? []), p.empId]);
  const dupValues = [...byValue].filter(([, ids]) => ids.length > 1);

  for (const p of plan) {
    console.log(`${p.cur ? "OVERWRITE" : "SET      "} ${p.empId.padEnd(11)} ${p.name} | ${p.dept}  ${JSON.stringify(p.cur)} -> ${p.value}`);
  }
  console.log(`\nInput rows: ${entries.length} | to update: ${plan.length} (SET ${plan.filter((p) => !p.cur).length}, OVERWRITE ${plan.filter((p) => p.cur).length}) | already correct: ${noChange} | skipped: ${problems.length}`);
  if (problems.length) { console.log("\nSKIPPED:"); problems.forEach((p) => console.log("  " + p)); }
  if (dupValues.length) { console.log("\nWARNING - same AICTE ID on more than one employee:"); dupValues.forEach(([v, ids]) => console.log(`  ${v}: ${ids.join(", ")}`)); }

  if (!apply) { console.log("\nDry run only - re-run with --apply to write."); return; }
  if (plan.length === 0) { console.log("Nothing to write."); return; }

  for (let i = 0; i < plan.length; i += 400) {
    const batch = db.batch();
    for (const p of plan.slice(i, i + 400)) batch.update(p.ref, { aicteFacultyId: p.value, updatedAt: FieldValue.serverTimestamp() });
    await batch.commit();
  }
  console.log(`Done - ${plan.length} written.`);
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
