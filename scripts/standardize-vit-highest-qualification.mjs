/**
 * Standardizes FacultyMember.highestQualification for one college (default:
 * VISHNU INSTITUTE OF TECHNOLOGY) so every faculty member has exactly ONE
 * qualification from the fixed category list, with no capitalization / dot /
 * formatting duplicates:
 *
 *   Ph.D, M.Tech, M.E, M.Sc, M.A, M.Phil, M.P.Ed, MSIT, MBA, B.Tech, B.Sc, Others
 *
 * The classification logic is src/lib/faculty/highestQualification.ts (imported
 * directly via Node's native TypeScript type stripping) - the SAME function the
 * Add/Edit forms and every write API route use, so the migrated data and newly
 * saved data can never disagree.
 *
 * Per faculty doc:
 *   - source value = highestQualification (new key) if present, else the legacy
 *     `qualification` key. If BOTH are present and classify differently, that is
 *     reported as a conflict and the newer `highestQualification` wins.
 *   - final value = the single highest category found (a value listing several
 *     degrees, e.g. "M.A, B.Ed, M.Phil", resolves to the highest: M.Phil); text
 *     that matches no category is kept verbatim as "Others".
 *   - writes highestQualification and deletes the legacy `qualification` key.
 *   - nothing else on the doc is touched (updatedAt is NOT bumped - this is a
 *     data standardization, not a user edit).
 *
 * Safety: dry-run by default; --apply first writes a JSON backup of every
 * value it is about to change (path printed; default is the OS temp dir, or
 * pass --backup <file>), then writes each doc with its lastUpdateTime as a
 * precondition, so a doc edited between read and write is skipped, not
 * clobbered. Idempotent - re-running skips already-standardized docs. Always
 * finishes with a verification report read back from Firestore.
 *
 * Usage:
 *   node scripts/standardize-vit-highest-qualification.mjs                  # dry run + projected report
 *   node scripts/standardize-vit-highest-qualification.mjs --apply
 *   node scripts/standardize-vit-highest-qualification.mjs --verify         # read-only report of current data
 *   node scripts/standardize-vit-highest-qualification.mjs --college "OTHER COLLEGE NAME"
 */

import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { classifyHighestQualification, HIGHEST_QUALIFICATION_OPTIONS } from "../src/lib/faculty/highestQualification.ts";

const APPLY = process.argv.includes("--apply");
const VERIFY_ONLY = process.argv.includes("--verify");
const argAfter = (flag) => { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : null; };
const COLLEGE_NAME = argAfter("--college") ?? "VISHNU INSTITUTE OF TECHNOLOGY";
const BACKUP_PATH = argAfter("--backup") ?? path.join(os.tmpdir(), `highest-qualification-backup-${Date.now()}.json`);

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
const CATEGORIES = [...HIGHEST_QUALIFICATION_OPTIONS];
const isBlank = (v) => typeof v !== "string" || v.trim() === "";
const label = (d) => d.employeeId ?? d.id;

async function findCollege() {
  const all = await db.collection("colleges").get();
  const matches = all.docs.filter((c) => (c.data().name ?? "").trim().toLowerCase() === COLLEGE_NAME.trim().toLowerCase());
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one college named "${COLLEGE_NAME}", found ${matches.length}`);
  }
  return matches[0];
}

// Plans one doc: what it holds now, what it should hold, and any flags.
function plan(doc) {
  const d = doc.data();
  const legacy = d.qualification;
  const current = d.highestQualification;
  const hasCurrent = !isBlank(current);
  const hasLegacy = !isBlank(legacy);
  const source = hasCurrent ? current : hasLegacy ? legacy : "";
  const cls = classifyHighestQualification(source);
  const conflict = hasCurrent && hasLegacy && classifyHighestQualification(current).value !== classifyHighestQualification(legacy).value;
  const needsWrite = !!cls.value && (d.highestQualification !== cls.value || "qualification" in d);
  return { doc, id: doc.id, employeeId: d.employeeId, legacy, current, source, final: cls.value, category: cls.category, ambiguous: cls.ambiguous, matched: cls.matched, conflict, missing: !cls.value, needsWrite };
}

// Report built from the docs' CURRENT stored values (used after --apply and for --verify).
function reportFromStored(docs, collegeName) {
  const counts = new Map(CATEGORIES.map((c) => [c, 0]));
  const others = [], missing = [], legacyLeft = [], nonCanonical = [], conflicts = [], apInfo = [];
  for (const doc of docs) {
    const d = doc.data();
    const v = d.highestQualification;
    if ("qualification" in d) legacyLeft.push(label(doc));
    if (isBlank(v)) { missing.push({ id: label(doc), qualification: d.qualification ?? null }); continue; }
    if (counts.has(v)) counts.set(v, counts.get(v) + 1);
    else {
      others.push({ id: label(doc), value: v });
      const c = classifyHighestQualification(v);
      if (c.category !== "Others") nonCanonical.push({ id: label(doc), value: v, wouldBe: c.value });
    }
    if (!isBlank(d.qualification) && classifyHighestQualification(d.qualification).value !== classifyHighestQualification(v).value) {
      conflicts.push({ id: label(doc), highestQualification: v, qualification: d.qualification });
    }
    const ap = d.academicProfile?.highestQualification;
    if (!isBlank(ap)) apInfo.push({ id: label(doc), doc: v, academicProfile: ap });
  }
  return { collegeName, total: docs.length, counts, others, missing, legacyLeft, nonCanonical, conflicts, apInfo };
}

function printReport(r, title) {
  console.log(`\n===== ${title} =====`);
  console.log(`College: ${r.collegeName}`);
  console.log(`Total faculty: ${r.total}`);
  console.log("Count per final qualification category:");
  let sum = 0;
  for (const [c, n] of r.counts) { console.log(`  ${c.padEnd(8)} ${n}`); sum += n; }
  console.log(`  ${"Others".padEnd(8)} ${r.others.length}`);
  sum += r.others.length;
  console.log(`  (categorized total ${sum} + missing ${r.missing.length} = ${sum + r.missing.length})`);
  console.log(`Records under Others: ${r.others.length}`);
  for (const o of r.others) console.log(`    ${o.id}: "${o.value}"`);
  console.log(`Records with a non-canonical value that WOULD map to a category (should be 0): ${r.nonCanonical.length}`);
  for (const o of r.nonCanonical) console.log(`    ${o.id}: "${o.value}" -> ${o.wouldBe}`);
  console.log(`Records with missing qualification: ${r.missing.length}`);
  for (const o of r.missing) console.log(`    ${o.id}: qualification=${JSON.stringify(o.qualification)}`);
  console.log(`Records still holding the legacy \`qualification\` key: ${r.legacyLeft.length}`);
  console.log(`Conflicts between qualification and highestQualification: ${r.conflicts.length}`);
  for (const o of r.conflicts) console.log(`    ${o.id}: highestQualification="${o.highestQualification}" vs qualification="${o.qualification}"`);
  console.log(`(info) academicProfile.highestQualification (separate Qualification-tab free-text field, untouched): ${r.apInfo.length} record(s)`);
  for (const o of r.apInfo) console.log(`    ${o.id}: doc-level="${o.doc}" academicProfile="${o.academicProfile}"`);
}

async function run() {
  const college = await findCollege();
  const collegeName = college.data().name;
  console.log(`College: ${college.id} (${collegeName})`);
  const load = async () => (await college.ref.collection("facultyMembers").get()).docs;

  if (VERIFY_ONLY) {
    printReport(reportFromStored(await load(), collegeName), "VERIFICATION (current Firestore data)");
    return;
  }

  const docs = await load();
  const plans = docs.map(plan);
  const toWrite = plans.filter((p) => p.needsWrite);
  const missing = plans.filter((p) => p.missing);
  const conflicts = plans.filter((p) => p.conflict);
  const ambiguous = plans.filter((p) => p.ambiguous);

  console.log(`\nAnalyzed ${plans.length} faculty records: ${toWrite.length} need updating, ${plans.length - toWrite.length - missing.length} already standardized, ${missing.length} missing a qualification.`);
  console.log("\nChanges by (before -> after):");
  const changeCounts = new Map();
  for (const p of toWrite) {
    const key = `${JSON.stringify(p.source)} -> ${JSON.stringify(p.final)}`;
    changeCounts.set(key, (changeCounts.get(key) ?? 0) + 1);
  }
  for (const [k, n] of [...changeCounts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
  if (ambiguous.length) {
    console.log(`\nMulti-degree values resolved to the highest (${ambiguous.length}):`);
    for (const p of ambiguous) console.log(`  ${label(p.doc)}: ${JSON.stringify(p.source)} -> ${p.final}  (found: ${p.matched.join(", ")})`);
  }
  if (conflicts.length) {
    console.log(`\nConflicts (highestQualification wins) (${conflicts.length}):`);
    for (const p of conflicts) console.log(`  ${label(p.doc)}: highestQualification=${JSON.stringify(p.current)} vs qualification=${JSON.stringify(p.legacy)}`);
  }

  if (!APPLY) {
    // Projected report: pretend the writes happened.
    const projected = reportFromStored(docs.map((doc) => {
      const p = plans.find((x) => x.doc === doc);
      const data = { ...doc.data() };
      if (p.needsWrite) { data.highestQualification = p.final; delete data.qualification; }
      return { data: () => data, id: doc.id };
    }), collegeName);
    printReport(projected, "PROJECTED RESULT (dry run - nothing written; pass --apply to write)");
    return;
  }

  // --- APPLY ---
  fs.writeFileSync(BACKUP_PATH, JSON.stringify(
    toWrite.map((p) => ({ path: p.doc.ref.path, id: p.id, employeeId: p.employeeId, before: { qualification: p.legacy ?? null, highestQualification: p.current ?? null }, after: p.final })),
    null, 2));
  console.log(`\nBackup of ${toWrite.length} original values written to: ${BACKUP_PATH}`);

  const totals = { written: 0, skippedConcurrent: 0, failed: 0 };
  for (const p of toWrite) {
    const updates = { highestQualification: p.final };
    if ("qualification" in p.doc.data()) updates.qualification = FieldValue.delete();
    try {
      await p.doc.ref.update(updates, { lastUpdateTime: p.doc.updateTime });
      totals.written++;
    } catch (e) {
      if (e && (e.code === 9 || /FAILED_PRECONDITION/.test(String(e.message)))) {
        totals.skippedConcurrent++;
        console.log(`  SKIP ${label(p.doc)}: edited concurrently - re-run to pick it up`);
      } else {
        totals.failed++;
        console.error(`  FAIL ${label(p.doc)}: ${e.message ?? e}`);
      }
    }
  }
  console.log(`\nAPPLIED: written ${totals.written}, skipped (edited concurrently) ${totals.skippedConcurrent}, failed ${totals.failed}`);

  printReport(reportFromStored(await load(), collegeName), "VERIFICATION (re-read from Firestore after writing)");
  if (totals.failed > 0) process.exitCode = 1;
}

run().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1); });
