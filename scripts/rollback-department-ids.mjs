/**
 * Restores what migrate-department-ids.mjs changed, from its ledger.jsonl.
 * For each ledger row and each changed path: restores the BEFORE value (deleting
 * the field if it was absent) - but only if the field still holds the migration's
 * AFTER value, so a value edited by someone since is never clobbered.
 *
 * Dry-run by default.
 *   node scripts/rollback-department-ids.mjs --ledger <dir/ledger.jsonl>
 *   node scripts/rollback-department-ids.mjs --ledger <dir/ledger.jsonl> --apply
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { FieldValue } from "firebase-admin/firestore";
import { initDb, parseArgs } from "./lib/departmentRefs.mjs";

const args = parseArgs();
const APPLY = args.flags.has("apply");
if (!args.values.ledger || !fs.existsSync(args.values.ledger)) { console.error("--ledger <ledger.jsonl> required"); process.exit(1); }
const db = initDb();

const getPath = (obj, p) => p.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let restored = 0, skipped = 0, docs = 0;
const rl = readline.createInterface({ input: fs.createReadStream(path.resolve(args.values.ledger)) });
for await (const line of rl) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  const ref = db.collection("colleges").doc(row.college).collection(row.collection).doc(row.docId);
  const snap = await ref.get();
  if (!snap.exists) { skipped++; continue; }
  const data = snap.data();
  const patch = {};
  for (const [p, after] of Object.entries(row.after)) {
    if (!same(getPath(data, p), after)) { skipped++; continue; } // changed since - leave it
    const prev = row.before[p];
    patch[p] = prev && prev.__absent ? FieldValue.delete() : prev;
    restored++;
  }
  if (Object.keys(patch).length) {
    docs++;
    if (APPLY) await ref.update(patch);
  }
}
console.log(`${APPLY ? "Restored" : "Would restore"} ${restored} field(s) across ${docs} doc(s); ${skipped} left alone (changed since migration / doc gone).`);
if (!APPLY) console.log("Dry run - re-run with --apply to write.");
