/**
 * One-off removal of the legacy `category` field from colleges/{id}/students docs.
 *
 * `category` was the free-text caste/reservation column ("OC / BC / SC / ST") on
 * the pre-2026-09-03 student roster (see src/lib/students/rosterFields.ts history,
 * commit 583ddbab). It was replaced by a validated `caste` (+ `subCaste`) field and
 * dropped from the current template/type entirely - no code on main/prasad-dev
 * reads or writes `category` any more, so any doc still carrying it is a leftover
 * from an import done against the old (uday/sivaathmika branch) template.
 *
 * SAFETY MODEL
 *  - Scope: colleges/{id}/students ONLY, and ONLY the `category` key. Never
 *    touches `caste`, `subCaste`, or any other field.
 *  - A doc that also has `caste` set keeps it untouched - only `category` is
 *    removed from it.
 *  - Each write carries the doc's lastUpdateTime as a precondition, so a record
 *    edited since this script read it is skipped, not clobbered.
 *  - Backup (full doc, before) written to Downloads before any write.
 *  - Dry-run by default. Write needs --apply --expect <N> matching the fresh plan.
 *
 * Usage:
 *   node scripts/remove-student-legacy-category-field.mjs                 # dry run
 *   node scripts/remove-student-legacy-category-field.mjs --apply --expect 41
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const EXPECT = (() => { const i = argv.indexOf("--expect"); return i !== -1 ? Number(argv[i + 1]) : null; })();
const OUT_DIR = path.join(os.homedir(), "Downloads", "remove-student-category");

const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
const privateKey = rawKey.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
if (!getApps().length) {
  initializeApp({ credential: cert({ projectId: process.env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey }) });
}
const db = getFirestore();

async function main() {
  const collegeNames = new Map((await db.collection("colleges").get()).docs.map((d) => [d.id, d.data().name ?? ""]));
  const snap = await db.collectionGroup("students").get();
  const targets = snap.docs.filter((d) => "category" in d.data());

  console.log(`students scanned: ${snap.size}`);
  console.log(`docs with legacy \`category\` field: ${targets.length}`);
  const byCollege = {};
  for (const d of targets) {
    const collegeId = d.ref.parent.parent.id;
    const name = collegeNames.get(collegeId) ?? "(no college doc)";
    byCollege[name] = (byCollege[name] ?? 0) + 1;
    const x = d.data();
    console.log(`  ${x.name ?? d.id} | college: ${name} | category="${x.category}" | caste=${x.caste ? `"${x.caste}" (kept)` : "unset"}`);
  }
  console.log("by college:", JSON.stringify(byCollege));

  if (!APPLY) {
    console.log(`\nDRY RUN - nothing written. Re-run with --apply --expect ${targets.length}`);
    return;
  }
  if (EXPECT !== targets.length) {
    throw new Error(`--expect ${EXPECT} does not match the fresh plan (${targets.length}) - aborting, nothing written`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = Object.fromEntries(targets.map((d) => [d.ref.path, d.data()]));
  const backupFile = path.join(OUT_DIR, `backup-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  console.log(`Backup: ${backupFile}`);

  let ok = 0, skipped = 0, failed = 0;
  for (const d of targets) {
    try {
      await d.ref.update({ category: FieldValue.delete() }, { lastUpdateTime: d.updateTime });
      ok++;
    } catch (e) {
      if (e && (e.code === 9 || /FAILED_PRECONDITION/.test(String(e.message)))) {
        skipped++;
        console.log(`  SKIP ${d.id} - edited concurrently, re-run to pick it up`);
      } else {
        failed++;
        console.error(`  FAIL ${d.id}: ${e.message ?? e}`);
      }
    }
  }
  console.log(`\nAPPLIED: ${ok} removed, ${skipped} skipped (concurrent edit), ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
