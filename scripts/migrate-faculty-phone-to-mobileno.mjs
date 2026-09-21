/**
 * Renames facultyMembers.phone -> facultyMembers.mobileNo (Faculty Details "Mobile No").
 *
 * Scope: ONLY colleges/{id}/facultyMembers. users.phone, supportingStaff.phone,
 * candidates.phone and every other `phone` field are different entities and untouched.
 *
 * Decision rules per document live in src/lib/faculty/mobileNoMigration.ts (imported here,
 * so the unit tests cover the exact logic that runs):
 *   only `phone`                     -> mobileNo = phone (verbatim, "" included), phone deleted
 *   both, equal after trim           -> phone deleted
 *   both, mobileNo empty             -> mobileNo = phone, phone deleted
 *   both, phone empty                -> phone deleted
 *   both, different, non-empty       -> CONFLICT: reported, NOT touched
 *   non-string value                 -> reported, NOT touched
 *   no `phone` key                   -> skipped (mobileNo is never invented)
 *
 * Safeguards:
 *   - DRY RUN by default: prints counts per category and employeeIds, never phone numbers.
 *   - --apply first writes backups/faculty-mobileno-<timestamp>.json (path, before/after
 *     values, updateTime) and re-reads it; aborts before any write if that fails.
 *   - Every write carries a lastUpdateTime precondition (a doc edited since it was read is
 *     skipped - re-run to pick it up) and does NOT bump updatedAt.
 *   - Each written doc is re-read and verified: mobileNo as planned, `phone` gone, every
 *     other field unchanged. Any failure prints FAIL and exits 1.
 *   - Idempotent: a second run plans nothing.
 *   - --verify: read-only whole-database check.
 *   - --rollback <backup.json>: restores `phone` (and the original mobileNo state) for docs
 *     whose mobileNo is still what this migration wrote; docs edited since are skipped.
 *
 * ORDER OF OPERATIONS: deploy the app version that reads `mobileNo ?? phone` and writes only
 * `mobileNo` FIRST, then --apply here, then --verify. Rolling the app back after --apply
 * needs --rollback first (old code reads only `phone`).
 *
 * Usage: node scripts/migrate-faculty-phone-to-mobileno.mjs                     (dry run)
 *        node scripts/migrate-faculty-phone-to-mobileno.mjs --apply
 *        node scripts/migrate-faculty-phone-to-mobileno.mjs --verify
 *        node scripts/migrate-faculty-phone-to-mobileno.mjs --rollback backups/<file>.json
 *   optional: --college <collegeId>
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { planMobileNo, mobileNoChange } from "../src/lib/faculty/mobileNoMigration.ts";

const APPLY = process.argv.includes("--apply");
const VERIFY = process.argv.includes("--verify");
const rollbackIdx = process.argv.indexOf("--rollback");
const ROLLBACK_FILE = rollbackIdx !== -1 ? process.argv[rollbackIdx + 1] : null;
const collegeArgIdx = process.argv.indexOf("--college");
const COLLEGE_FILTER = collegeArgIdx !== -1 ? process.argv[collegeArgIdx + 1] : null;

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

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, sortDeep(v[k])]));
  return v;
}
const stable = (v) => JSON.stringify(sortDeep(v));
const withoutMobileKeys = ({ phone, mobileNo, ...rest }) => rest;
const label = (d) => `${d.data().employeeId ?? d.id} [${d.ref.path}]`;

async function loadAll() {
  const snap = await db.collectionGroup("facultyMembers").get();
  return snap.docs.filter((d) => !COLLEGE_FILTER || d.ref.path.split("/")[1] === COLLEGE_FILTER);
}

async function rollback(file) {
  const entries = JSON.parse(fs.readFileSync(file, "utf8"));
  let restored = 0, skipped = 0;
  for (const e of entries) {
    const ref = db.doc(e.path);
    const snap = await ref.get();
    if (!snap.exists) { skipped++; console.log(`SKIP ${e.path}: document no longer exists`); continue; }
    const cur = snap.data();
    if (cur.mobileNo !== e.after.mobileNo || "phone" in cur) {
      skipped++; console.log(`SKIP ${e.path}: changed since the migration - not overwriting`); continue;
    }
    const update = { phone: e.before.phone };
    update.mobileNo = "mobileNo" in e.before ? e.before.mobileNo : FieldValue.delete();
    await ref.update(update, { lastUpdateTime: snap.updateTime });
    restored++;
  }
  console.log(`Rollback: ${restored} restored, ${skipped} skipped.`);
}

async function run() {
  if (ROLLBACK_FILE) return rollback(ROLLBACK_FILE);

  const docs = await loadAll();
  const counts = {};
  const bump = (k) => (counts[k] = (counts[k] ?? 0) + 1);
  const items = docs.map((d) => ({ doc: d, before: d.data(), plan: planMobileNo(d.data()) }));
  for (const { doc, plan } of items) {
    bump(plan.kind);
    if (plan.kind === "conflict" || plan.kind === "non-string") console.log(`REVIEW ${plan.kind.toUpperCase()} ${label(doc)}`);
  }
  console.log(`Scanned ${docs.length} facultyMembers documents${COLLEGE_FILTER ? ` (college ${COLLEGE_FILTER})` : ""}.`);
  console.log("Plan:", JSON.stringify(counts));

  if (VERIFY) {
    const withPhone = items.filter(({ before }) => "phone" in before).length;
    const withMobile = items.filter(({ before }) => "mobileNo" in before).length;
    const blocked = items.filter(({ plan }) => plan.kind === "conflict" || plan.kind === "non-string").length;
    const pending = items.filter(({ plan }) => mobileNoChange(plan)).length;
    console.log(`Verify: ${withPhone} doc(s) still have \`phone\`, ${withMobile} have \`mobileNo\`, ${pending} still to migrate, ${blocked} need manual review.`);
    process.exit(pending > 0 || blocked > 0 ? 1 : 0);
  }

  const targets = items.filter(({ plan }) => mobileNoChange(plan));
  console.log(`${targets.length} document(s) ${APPLY ? "will be written" : "would be written"}.`);
  if (!APPLY) { console.log("Dry run - nothing written. Re-run with --apply (a backup is taken first)."); return; }
  if (targets.length === 0) return;

  // --- backup, checked before any write ---
  const backup = targets.map(({ doc, before, plan }) => {
    const change = mobileNoChange(plan);
    return {
      path: doc.ref.path, updateTime: doc.updateTime.toDate().toISOString(), kind: plan.kind,
      before: { phone: before.phone, ...("mobileNo" in before ? { mobileNo: before.mobileNo } : {}) },
      after: { mobileNo: change.mobileNo !== undefined ? change.mobileNo : before.mobileNo },
    };
  });
  const dir = path.resolve("backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `faculty-mobileno-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 1));
  const reread = JSON.parse(fs.readFileSync(file, "utf8"));
  if (reread.length !== targets.length || stable(reread) !== stable(backup)) {
    console.error("Backup verification failed - aborting, nothing was written.");
    process.exit(1);
  }
  console.log(`Backup written and verified: ${file}`);

  let written = 0, skipped = 0, failed = 0;
  for (const { doc, before, plan } of targets) {
    const change = mobileNoChange(plan);
    const update = { phone: FieldValue.delete() };
    if (change.mobileNo !== undefined) update.mobileNo = change.mobileNo;
    try {
      await doc.ref.update(update, { lastUpdateTime: doc.updateTime });
    } catch (e) {
      skipped++;
      console.log(`SKIP ${label(doc)}: ${e.code === 9 || /precondition/i.test(String(e.message)) ? "changed since it was read" : e.message}`);
      continue;
    }
    written++;
    const after = (await doc.ref.get()).data();
    const problems = [];
    if ("phone" in after) problems.push("phone still present");
    const expected = change.mobileNo !== undefined ? change.mobileNo : before.mobileNo;
    if (after.mobileNo !== expected) problems.push("mobileNo not as planned");
    if (stable(withoutMobileKeys(after)) !== stable(withoutMobileKeys(before))) problems.push("other fields changed");
    if (problems.length) { failed++; console.log(`FAIL ${label(doc)}: ${problems.join("; ")}`); }
  }
  console.log(`\nDone: ${written} written, ${skipped} skipped (re-run to retry), ${failed} FAILED verification.`);
  if (failed) { console.log(`Restore with: node scripts/migrate-faculty-phone-to-mobileno.mjs --rollback ${file}`); process.exit(1); }
}

run().catch((e) => { console.error(e); process.exit(1); });
