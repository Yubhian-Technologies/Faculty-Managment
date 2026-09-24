/**
 * Combines the legacy Height (Feet) + Height (Inches) number fields into a single
 * `height` string field, "<feet>.<inches>" (e.g. "5.7" = 5 ft 7 in, "5.11" = 5 ft
 * 11 in) - see migrateHeight() in src/lib/faculty/fieldRenames.ts, which does the
 * exact same combine at read time for any document this script hasn't reached yet
 * (imported here directly, so this script and the app's runtime fallback can never
 * disagree about the resulting value).
 *
 * `height` is a STRING, not a number - two-digit inches (.10/.11) would collapse
 * under float parsing (5.10 === 5.1, misread as 5 ft 1 in), so the value is never
 * parsed back to a number anywhere.
 *
 * Scope: colleges/{id}/facultyMembers and colleges/{id}/supportingStaff - the only
 * two collections that ever had heightFeet/heightInches. users docs never had them.
 *
 * Safeguards:
 *   - DRY RUN by default: prints counts per collection, never writes.
 *   - --apply first writes backups/faculty-height-<timestamp>.json (path, before/
 *     after values, updateTime) and re-reads it; aborts before any write if that fails.
 *   - Every write carries a lastUpdateTime precondition (a doc edited since it was
 *     read is skipped - re-run to pick it up) and does NOT bump updatedAt.
 *   - Each written doc is re-read and verified: height as planned, heightFeet/
 *     heightInches gone, every other field unchanged. Any failure prints FAIL and exits 1.
 *   - Idempotent: a second run plans nothing (docs with neither legacy key are skipped).
 *   - --verify: read-only whole-database check.
 *   - --rollback <backup.json>: restores heightFeet/heightInches (and the original
 *     height state) for docs whose height is still what this migration wrote; docs
 *     edited since are skipped.
 *
 * ORDER OF OPERATIONS: deploy the app version that reads/writes `height` (with the
 * migrateHeight() runtime fallback for un-migrated docs) FIRST, then --apply here,
 * then --verify. Rolling the app back after --apply needs --rollback first (old code
 * reads/writes only heightFeet/heightInches).
 *
 * Usage: node scripts/migrate-faculty-height.mjs                     (dry run)
 *        node scripts/migrate-faculty-height.mjs --apply
 *        node scripts/migrate-faculty-height.mjs --verify
 *        node scripts/migrate-faculty-height.mjs --rollback backups/<file>.json
 *   optional: --college <collegeId>
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { migrateHeight } from "../src/lib/faculty/fieldRenames.ts";

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

const COLLECTIONS = ["facultyMembers", "supportingStaff"];

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, sortDeep(v[k])]));
  return v;
}
const stable = (v) => JSON.stringify(sortDeep(v));
const withoutHeightKeys = ({ heightFeet, heightInches, height, ...rest }) => rest;
const label = (d) => `${d.data().employeeId ?? d.id} [${d.ref.path}]`;
const hasLegacyHeight = (data) => "heightFeet" in data || "heightInches" in data;

async function loadAll() {
  const docs = [];
  for (const coll of COLLECTIONS) {
    const snap = await db.collectionGroup(coll).get();
    for (const d of snap.docs) {
      if (COLLEGE_FILTER && d.ref.path.split("/")[1] !== COLLEGE_FILTER) continue;
      docs.push(d);
    }
  }
  return docs;
}

async function rollback(file) {
  const entries = JSON.parse(fs.readFileSync(file, "utf8"));
  let restored = 0, skipped = 0;
  for (const e of entries) {
    const ref = db.doc(e.path);
    const snap = await ref.get();
    if (!snap.exists) { skipped++; console.log(`SKIP ${e.path}: document no longer exists`); continue; }
    const cur = snap.data();
    if (cur.height !== e.after.height || hasLegacyHeight(cur)) {
      skipped++; console.log(`SKIP ${e.path}: changed since the migration - not overwriting`); continue;
    }
    const update = { height: "height" in e.before ? e.before.height : FieldValue.delete() };
    update.heightFeet = "heightFeet" in e.before ? e.before.heightFeet : FieldValue.delete();
    update.heightInches = "heightInches" in e.before ? e.before.heightInches : FieldValue.delete();
    await ref.update(update, { lastUpdateTime: snap.updateTime });
    restored++;
  }
  console.log(`Rollback: ${restored} restored, ${skipped} skipped.`);
}

async function run() {
  if (ROLLBACK_FILE) return rollback(ROLLBACK_FILE);

  const docs = await loadAll();
  const items = docs.map((d) => ({ doc: d, before: d.data() }));
  const targets = items.filter(({ before }) => hasLegacyHeight(before));

  console.log(`Scanned ${docs.length} facultyMembers/supportingStaff documents${COLLEGE_FILTER ? ` (college ${COLLEGE_FILTER})` : ""}.`);

  if (VERIFY) {
    const withHeight = items.filter(({ before }) => "height" in before).length;
    console.log(`Verify: ${targets.length} doc(s) still have heightFeet/heightInches, ${withHeight} have \`height\`.`);
    process.exit(targets.length > 0 ? 1 : 0);
  }

  console.log(`${targets.length} document(s) ${APPLY ? "will be written" : "would be written"}.`);
  if (!APPLY) { console.log("Dry run - nothing written. Re-run with --apply (a backup is taken first)."); return; }
  if (targets.length === 0) return;

  // --- backup, checked before any write ---
  const backup = targets.map(({ doc, before }) => {
    const migrated = migrateHeight(before);
    return {
      path: doc.ref.path, updateTime: doc.updateTime.toDate().toISOString(),
      before: {
        ...("heightFeet" in before ? { heightFeet: before.heightFeet } : {}),
        ...("heightInches" in before ? { heightInches: before.heightInches } : {}),
        ...("height" in before ? { height: before.height } : {}),
      },
      after: { height: migrated.height },
    };
  });
  const dir = path.resolve("backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `faculty-height-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 1));
  const reread = JSON.parse(fs.readFileSync(file, "utf8"));
  if (reread.length !== targets.length || stable(reread) !== stable(backup)) {
    console.error("Backup verification failed - aborting, nothing was written.");
    process.exit(1);
  }
  console.log(`Backup written and verified: ${file}`);

  let written = 0, skipped = 0, failed = 0;
  for (const { doc, before } of targets) {
    const migrated = migrateHeight(before);
    const update = { heightFeet: FieldValue.delete(), heightInches: FieldValue.delete() };
    if (migrated.height !== undefined) update.height = migrated.height;
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
    if ("heightFeet" in after) problems.push("heightFeet still present");
    if ("heightInches" in after) problems.push("heightInches still present");
    const expectedHeight = migrated.height !== undefined ? migrated.height : before.height;
    if (after.height !== expectedHeight) problems.push("height not as planned");
    if (stable(withoutHeightKeys(after)) !== stable(withoutHeightKeys(before))) problems.push("other fields changed");
    if (problems.length) { failed++; console.log(`FAIL ${label(doc)}: ${problems.join("; ")}`); }
  }
  console.log(`\nDone: ${written} written, ${skipped} skipped (re-run to retry), ${failed} FAILED verification.`);
  if (failed) { console.log(`Restore with: node scripts/migrate-faculty-height.mjs --rollback ${file}`); process.exit(1); }
}

run().catch((e) => { console.error(e); process.exit(1); });
