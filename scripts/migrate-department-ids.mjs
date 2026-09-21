/**
 * Backfills `departmentId` (and the *Ids arrays) next to every department NAME
 * reference, per college. ADDITIVE: it only adds id fields and, when a value was
 * matched through a code / stale name / case-spacing variant, normalises the
 * display name to the department's current canonical name. Nothing is deleted.
 *
 * RESOLUTION (per value): exact id -> normalised name -> short code -> the
 * per-college mapping file scripts/dept-mappings/<collegeId>.json (stale/legacy
 * strings -> id | code | current name). Anything blank/none/ambiguous is
 * QUARANTINED (not written) and listed in unresolved.csv - never guessed.
 *
 * SAFETY MODEL
 *  - Dry-run by default: prints the plan, writes only plan/unresolved files.
 *  - --apply requires: --college <id> (one college at a time), --expect <N> (must
 *    equal the fresh plan's change count so a stale approval cannot apply) and
 *    --backup <dir> pointing at a backup-department-data.mjs output (manifest.json).
 *  - Refuses to apply while the college has department uniqueness problems
 *    (duplicate/ambiguous names or codes) - fix those first (audit reports them).
 *  - An existing departmentId that DISAGREES with what the name resolves to is a
 *    conflict: quarantined, never overwritten.
 *  - An array with ANY unresolved element is skipped entirely (a partial id array
 *    would silently drop access once queries switch to ids).
 *  - Every write carries the doc's lastUpdateTime as a precondition; a doc edited
 *    since it was read is skipped and reported, not clobbered.
 *  - Every change is appended to <out>/ledger.jsonl (before/after per field) so
 *    rollback-department-ids.mjs can restore it.
 *  - Idempotent: a second run plans 0 changes.
 *  - Also backfills the colleges/{id}/departmentKeys uniqueness lock docs.
 *
 * Usage:
 *   node scripts/migrate-department-ids.mjs                                   # dry run, all colleges
 *   node scripts/migrate-department-ids.mjs --college <id> --collection students
 *   node scripts/migrate-department-ids.mjs --college <id> --apply --expect 812 --backup <backupDir>
 */

import fs from "node:fs";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import {
  DEFAULT_OUT_BASE, DEPARTMENT_REF_FIELDS, buildIndex, initDb, loadDepartments, loadMapping, normCode, normName,
  parseArgs, resolveValue, streamDocs, timestampDir, writeCsv,
} from "./lib/departmentRefs.mjs";
import crypto from "node:crypto";

const args = parseArgs();
const APPLY = args.flags.has("apply");
const db = initDb();
const outDir = args.values.out ? path.resolve(args.values.out) : timestampDir(path.join(DEFAULT_OUT_BASE, APPLY ? "apply" : "plan"));
fs.mkdirSync(outDir, { recursive: true });

if (APPLY) {
  if (!args.values.college) fail("--apply requires --college <id> (one college at a time)");
  if (args.values.expect === undefined) fail("--apply requires --expect <N> (the change count from a fresh dry run)");
  const manifest = path.join(path.resolve(args.values.backup ?? ""), "manifest.json");
  if (!args.values.backup || !fs.existsSync(manifest)) fail("--apply requires --backup <dir> containing manifest.json from backup-department-data.mjs");
  const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const hasCollege = Object.keys(m.files).some((k) => k.startsWith(`${args.values.college}/`));
  if (!hasCollege) fail(`backup manifest has no files for college ${args.values.college}`);
}
function fail(msg) { console.error(`ERROR: ${msg}`); process.exit(1); }

const keyDocId = (field, raw) => `${field}_${crypto.createHash("sha256").update(field === "name" ? normName(raw) : normCode(raw)).digest("hex").slice(0, 40)}`;

function uniquenessProblems(depts) {
  const n = new Map(), c = new Map(), problems = [];
  for (const d of depts) {
    (n.get(normName(d.name)) ?? n.set(normName(d.name), []).get(normName(d.name))).push(d.id);
    (c.get(normCode(d.code)) ?? c.set(normCode(d.code), []).get(normCode(d.code))).push(d.id);
  }
  for (const [k, ids] of n) if (k && ids.length > 1) problems.push(`duplicate name "${k}": ${ids.join(",")}`);
  for (const [k, ids] of c) if (k && ids.length > 1) problems.push(`duplicate code "${k}": ${ids.join(",")}`);
  for (const d of depts) for (const o of depts) {
    if (o.id !== d.id && normCode(d.name) && normCode(d.name) === normCode(o.code)) problems.push(`name of ${d.id} equals code of ${o.id}: "${d.name}"`);
  }
  return problems;
}

const sameArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
const isAbsent = (v) => v === undefined || v === null;

/** Builds { patch, before, issues } for one doc across all its catalog entries. */
function planDoc(entries, data, index, mapping) {
  const patch = {}, before = {}, issues = [];
  const set = (p, value, prev) => { patch[p] = value; before[p] = prev === undefined ? { __absent: true } : prev; };
  const nameOfId = (id) => index.byId.get(id)?.name ?? "";

  for (const e of entries) {
    if (e.kind === "scalar") {
      const raw = data[e.field];
      if (typeof raw !== "string" || !raw.trim()) continue; // blank/absent: nothing to resolve
      const r = resolveValue(index, raw, mapping);
      if (!r.ok) { issues.push({ field: e.field, value: raw, reason: r.reason, candidates: (r.candidates ?? []).join("|") }); continue; }
      const existingId = data[e.idField];
      if (!isAbsent(existingId) && existingId !== "" && existingId !== r.id) {
        issues.push({ field: e.field, value: raw, reason: `id_conflict(existing ${existingId} vs resolved ${r.id})`, candidates: "" });
        continue;
      }
      if (existingId !== r.id) set(e.idField, r.id, existingId);
      if (raw !== nameOfId(r.id) && nameOfId(r.id)) set(e.field, nameOfId(r.id), raw);
    } else if (e.kind === "array") {
      const arr = data[e.field];
      if (!Array.isArray(arr) || arr.length === 0) continue;
      const res = arr.map((v) => resolveValue(index, v, mapping));
      const bad = res.findIndex((x) => !x.ok);
      if (bad >= 0) { issues.push({ field: `${e.field}[${bad}]`, value: arr[bad], reason: res[bad].reason, candidates: (res[bad].candidates ?? []).join("|") }); continue; }
      const ids = res.map((x) => x.id);
      const names = res.map((x) => x.name);
      if (!sameArr(data[e.idField], ids)) set(e.idField, ids, data[e.idField]);
      if (!sameArr(arr, names)) set(e.field, names, arr);
    } else if (e.kind === "nestedScopes") {
      for (const [catalogId, scope] of Object.entries(data.courseScopes ?? {})) {
        const arr = scope?.secondaryDepartments;
        if (!Array.isArray(arr) || arr.length === 0) continue;
        const res = arr.map((v) => resolveValue(index, v, mapping));
        const bad = res.findIndex((x) => !x.ok);
        const label = `courseScopes.${catalogId}.secondaryDepartments`;
        if (bad >= 0) { issues.push({ field: `${label}[${bad}]`, value: arr[bad], reason: res[bad].reason, candidates: "" }); continue; }
        const ids = res.map((x) => x.id), names = res.map((x) => x.name);
        if (!sameArr(scope.secondaryDepartmentIds, ids)) set(`courseScopes.${catalogId}.secondaryDepartmentIds`, ids, scope.secondaryDepartmentIds);
        if (!sameArr(arr, names)) set(label, names, arr);
      }
    }
  }
  return { patch, before, issues };
}

const colleges = args.values.college
  ? [await db.collection("colleges").doc(args.values.college).get()]
  : (await db.collection("colleges").get()).docs;

const byCollection = new Map();
for (const e of DEPARTMENT_REF_FIELDS) {
  if (args.values.collection && e.collection !== args.values.collection) continue;
  (byCollection.get(e.collection) ?? byCollection.set(e.collection, []).get(e.collection)).push(e);
}

const planned = []; // { college, collection, ref, updateTime, patch, before }
const keyPlans = []; // { college, ref, data }
const unresolved = [];
const perCollege = {};

for (const college of colleges) {
  if (!college.exists) continue;
  const depts = await loadDepartments(college.ref);
  const index = buildIndex(depts);
  const mapping = loadMapping(college.id);
  const problems = uniquenessProblems(depts);
  perCollege[college.id] = { name: college.data()?.name ?? "", departments: depts.length, uniquenessProblems: problems, changes: {}, issues: 0 };
  console.log(`\n=== ${college.id} ${perCollege[college.id].name} (${depts.length} departments, ${mapping.size} mapping entries) ===`);
  if (problems.length) {
    console.log("  !! department uniqueness problems - resolve before applying:");
    problems.forEach((p) => console.log(`     ${p}`));
  }

  for (const [collection, entries] of byCollection) {
    let changed = 0;
    for await (const doc of streamDocs(college.ref.collection(collection))) {
      const { patch, before, issues } = planDoc(entries, doc.data(), index, mapping);
      for (const i of issues) unresolved.push({ college: college.id, collection, docId: doc.id, ...i });
      perCollege[college.id].issues += issues.length;
      if (Object.keys(patch).length) {
        changed++;
        planned.push({ college: college.id, collection, ref: doc.ref, updateTime: doc.updateTime, patch, before });
      }
    }
    if (changed) { perCollege[college.id].changes[collection] = changed; console.log(`  ${collection}: ${changed} doc(s) to change`); }
  }

  // Uniqueness lock docs for existing departments.
  if (!args.values.collection || args.values.collection === "departments") {
    for (const d of depts) {
      for (const field of ["name", "code"]) {
        if (!d[field]) continue;
        const ref = college.ref.collection("departmentKeys").doc(keyDocId(field, d[field]));
        const snap = await ref.get();
        if (!snap.exists) keyPlans.push({ college: college.id, ref, data: { departmentId: d.id, field, updatedAt: new Date() } });
        else if (snap.data().departmentId !== d.id) unresolved.push({ college: college.id, collection: "departmentKeys", docId: ref.id, field, value: d[field], reason: `key_owned_by(${snap.data().departmentId})`, candidates: "" });
      }
    }
  }
}

const total = planned.length + keyPlans.length;
fs.writeFileSync(path.join(outDir, "plan.json"), JSON.stringify({ perCollege, docChanges: planned.length, keyDocs: keyPlans.length, unresolved: unresolved.length }, null, 2));
fs.writeFileSync(path.join(outDir, "planned-changes.jsonl"), planned.map((p) => JSON.stringify({ college: p.college, collection: p.collection, docId: p.ref.id, before: p.before, after: p.patch })).join("\n"));
writeCsv(path.join(outDir, "unresolved.csv"), unresolved, ["college", "collection", "docId", "field", "value", "reason", "candidates"]);
console.log(`\nPlan: ${planned.length} doc change(s) + ${keyPlans.length} uniqueness lock doc(s) = ${total}; ${unresolved.length} unresolved/quarantined.`);
console.log(`Files: ${outDir}`);

if (!APPLY) {
  console.log(`\nDry run - nothing written. To apply one college: --college <id> --apply --expect ${total} --backup <backupDir>`);
  process.exit(0);
}

if (perCollege[args.values.college]?.uniquenessProblems.length) fail("college has department uniqueness problems; not applying");
if (String(total) !== String(args.values.expect)) fail(`--expect ${args.values.expect} does not match the fresh plan (${total}); re-run the dry run and review`);

const ledger = fs.createWriteStream(path.join(outDir, "ledger.jsonl"), { flags: "a" });
let ok = 0, skipped = 0;
const skippedRows = [];
const CONC = 20;
for (let i = 0; i < planned.length; i += CONC) {
  await Promise.all(planned.slice(i, i + CONC).map(async (p) => {
    try {
      // No updatedAt bump: this migration must not change any other field.
      await p.ref.update(p.patch, { lastUpdateTime: p.updateTime });
      ledger.write(JSON.stringify({ college: p.college, collection: p.collection, docId: p.ref.id, before: p.before, after: p.patch }) + "\n");
      ok++;
    } catch (e) {
      skipped++;
      skippedRows.push({ college: p.college, collection: p.collection, docId: p.ref.id, error: e instanceof Error ? e.message : String(e) });
    }
  }));
  process.stdout.write(`\r  applied ${ok}/${planned.length}`);
}
for (const k of keyPlans) {
  try { await k.ref.create(k.data); ok++; } catch (e) { skipped++; skippedRows.push({ college: k.college, collection: "departmentKeys", docId: k.ref.id, error: e instanceof Error ? e.message : String(e) }); }
}
ledger.end();
if (skippedRows.length) writeCsv(path.join(outDir, "skipped.csv"), skippedRows, ["college", "collection", "docId", "error"]);
console.log(`\nDone: ${ok} written, ${skipped} skipped (edited since read / lock exists - re-run the dry run; the migration is idempotent).`);
void FieldValue;
