/**
 * Faculty name model migration: legalName is the ONLY identity/display name,
 * nameAsPerPan is an optional PAN field independent of legalName (like
 * nameAsPerAadhar), and the legacy `facultyMembers.name` key is retired.
 *
 * Scope: colleges/{id}/facultyMembers ONLY. Never touches users, systemUsers or
 * supportingStaff (their `name` is a different thing). Never derives
 * nameAsPerPan from legalName, and never treats a hire-provisioned name as PAN.
 *
 * Classification of every doc that has a non-empty `name`:
 *   G  has legalName too                -> nameAsPerPan = trim(name)      (Step A)
 *   P  no legalName, hire-provisioned   -> legalName    = trim(name)      (Step A)
 *      (candidateId/offerId set; only if candidates/{candidateId}.name matches)
 *   M  no legalName, not provisioned    -> legalName    = trim(name)      (Step A)
 *      (demo/test records; owner-approved - same rule as P)
 *   E  `name` is an empty string        -> nothing written; key deleted    (Step D)
 * Anything else (both keys present and different, a P record whose candidate does
 * not match, a P/M record in the VIT college, ...) is REPORTED and never written.
 *
 * Sequence (expand, then contract):
 *   Step A  (default)  additive: writes nameAsPerPan / legalName, KEEPS `name`.
 *                      Run BEFORE deploying the code that stops reading `name`.
 *   Step D  (--step D) contract: deletes `name` once every doc that had one has
 *                      its value safely in legalName / nameAsPerPan. Run after the
 *                      new code has been live and verified.
 *
 * Safety: dry-run by default. Writes need `--apply --expect G=..,P=..,M=..`
 * matching the FRESH plan. Every write carries the doc's lastUpdateTime as a
 * precondition, never bumps updatedAt, and is idempotent. A JSON backup + manifest
 * is written to Downloads before any write.
 *
 * Usage:
 *   node scripts/migrate-faculty-name-model.mjs                                   # Step A dry run
 *   node scripts/migrate-faculty-name-model.mjs --apply --expect G=153,P=9,M=37   # Step A
 *   node scripts/migrate-faculty-name-model.mjs --verify <manifest-A.json>        # read-only checks
 *   node scripts/migrate-faculty-name-model.mjs --step D --manifest <manifest-A.json>              # Step D dry run
 *   node scripts/migrate-faculty-name-model.mjs --step D --manifest <A.json> --apply --expect D=202
 *   node scripts/migrate-faculty-name-model.mjs --rollback <manifest-A|D.json> [--apply]
 * Options: --out <dir>  --college-id <id>  --allow-vit
 */

import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const VIT_COLLEGE_NAME = "VISHNU INSTITUTE OF TECHNOLOGY";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
const APPLY = flag("--apply");
const STEP = (opt("--step", "A") ?? "A").toUpperCase();
const OUT_DIR = opt("--out", path.join(os.homedir(), "Downloads", "faculty-name-model-migration"));
const ONLY_COLLEGE = opt("--college-id");
const ALLOW_VIT = flag("--allow-vit");
const EXPECT = Object.fromEntries((opt("--expect", "") ?? "").split(",").filter(Boolean).map((kv) => { const [k, v] = kv.split("="); return [k.trim().toUpperCase(), Number(v)]; }));

const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
const privateKey = rawKey.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
if (!getApps().length) {
  initializeApp({ credential: cert({ projectId: process.env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey }) });
}
const db = getFirestore();

// ─── helpers ────────────────────────────────────────────────────────────────
const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const trim = (v) => str(v).trim();
const loose = (v) => trim(v).replace(/\s+/g, " ").toLowerCase();
const norm = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v?.toMillis === "function") return { __ts: `${v.seconds}.${v.nanoseconds}` };
  if (v?.path && v?.firestore) return { __ref: v.path };
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]));
  return v;
};
const sha = (o) => crypto.createHash("sha256").update(JSON.stringify(norm(o))).digest("hex");
// Fingerprint of everything EXCEPT the three name keys (and updatedAt, tracked separately).
const NAME_KEYS = new Set(["name", "legalName", "nameAsPerPan", "updatedAt"]);
const fingerprint = (data) => sha(Object.fromEntries(Object.entries(data).filter(([k]) => !NAME_KEYS.has(k))));
const tsIso = (t) => (t?.toDate ? t.toDate().toISOString() : null);
const now = () => new Date().toISOString().replace(/[:.]/g, "-");
const ensureOut = () => fs.mkdirSync(OUT_DIR, { recursive: true });

// Collection-group scan (not a walk over college docs): some facultyMembers live under
// college IDs whose college document no longer exists (leftover test data). Those are
// included so the counts match a full census; they are labelled "(no college doc)".
async function loadFaculty() {
  const names = new Map((await db.collection("colleges").get()).docs.map((c) => [c.id, trim(c.data().name)]));
  const out = [];
  for (const d of (await db.collectionGroup("facultyMembers").get()).docs) {
    const collegeId = d.ref.parent.parent.id;
    if (ONLY_COLLEGE && collegeId !== ONLY_COLLEGE) continue;
    out.push({ collegeId, collegeName: names.get(collegeId) ?? "", orphan: !names.has(collegeId), doc: d });
  }
  return out;
}

async function untouchedFingerprint() {
  // users / systemUsers / supportingStaff must be byte-identical after the run.
  const out = {};
  for (const name of ["users", "supportingStaff"]) {
    const items = (await db.collectionGroup(name).get()).docs.map((d) => [d.ref.path, norm(d.data())]);
    items.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    out[name] = { count: items.length, hash: sha(items) };
  }
  const su = (await db.collection("systemUsers").get()).docs.map((d) => [d.ref.path, norm(d.data())]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  out.systemUsers = { count: su.length, hash: sha(su) };
  return out;
}

// ─── classification (Step A) ────────────────────────────────────────────────
async function classify(items) {
  const plan = { G: [], P: [], M: [], E: [], migrated: [], conflicts: [], blocked: [], noName: 0, untrimmed: [] };
  for (const it of items) {
    const x = it.doc.data();
    const label = `${x.employeeId ?? it.doc.id} (${it.collegeName || (it.orphan ? "no college doc: " + it.collegeId.slice(0, 6) : it.collegeId)})`;
    if (!("name" in x)) { plan.noName++; continue; }
    const rawName = str(x.name);
    const n = rawName.trim();
    if (!n) { plan.E.push({ ...it, label }); continue; }
    if (rawName !== n) plan.untrimmed.push(label);
    const l = trim(x.legalName);
    const pan = trim(x.nameAsPerPan);
    if (l) {
      if (!pan) plan.G.push({ ...it, label, write: { nameAsPerPan: n } });
      else if (pan === n) plan.migrated.push({ ...it, label });
      else plan.conflicts.push({ ...it, label, reason: "nameAsPerPan already set and differs from name - not overwritten" });
      continue;
    }
    // No legalName: `name` is this record's only identity name.
    const isVit = it.collegeName.toUpperCase() === VIT_COLLEGE_NAME;
    if (isVit && !ALLOW_VIT) { plan.blocked.push({ ...it, label, reason: "VIT record with no legalName - refusing without --allow-vit" }); continue; }
    if (pan) { plan.blocked.push({ ...it, label, reason: "no legalName but nameAsPerPan already set - needs manual review" }); continue; }
    if (x.candidateId || x.offerId) {
      const cand = x.candidateId ? await db.doc(`colleges/${it.collegeId}/candidates/${x.candidateId}`).get() : null;
      if (cand?.exists && loose(cand.data().name) === loose(n)) plan.P.push({ ...it, label, write: { legalName: n } });
      else plan.blocked.push({ ...it, label, reason: "hire-provisioned but candidate record missing or name differs - not classified" });
    } else {
      plan.M.push({ ...it, label, write: { legalName: n } });
    }
  }
  return plan;
}

function printStepA(plan) {
  console.log("\nStep A plan (additive - `name` is kept):");
  console.log(`  G  nameAsPerPan <- name (has legalName)       : ${plan.G.length}`);
  console.log(`  P  legalName    <- name (hire-provisioned)     : ${plan.P.length}`);
  console.log(`  M  legalName    <- name (manual, demo/test)    : ${plan.M.length}`);
  console.log(`  already migrated (nameAsPerPan == name)        : ${plan.migrated.length}`);
  console.log(`  E  empty-string name (nothing written)         : ${plan.E.length}`);
  console.log(`  conflicts (reported, never written)            : ${plan.conflicts.length}`);
  console.log(`  blocked (reported, never written)              : ${plan.blocked.length}`);
  console.log(`  docs with no name key                          : ${plan.noName}`);
  console.log(`  names with leading/trailing whitespace (trimmed): ${plan.untrimmed.length}`);
  const list = (title, arr) => { if (arr.length) { console.log(`\n${title}`); for (const a of arr) console.log(`  ${a.label}${a.reason ? "  -> " + a.reason : ""}  created ${tsIso(a.doc.data().createdAt)?.slice(0, 10) ?? "-"}`); } };
  list("P - hire-provisioned (legalName will be set):", plan.P);
  list("M - manual demo/test (legalName will be set):", plan.M);
  list("CONFLICTS:", plan.conflicts);
  list("BLOCKED:", plan.blocked);
  const byCollege = {};
  for (const g of plan.G) { const k = g.collegeName || `(no college doc) ${g.collegeId.slice(0, 6)}`; byCollege[k] = (byCollege[k] ?? 0) + 1; }
  console.log("\nG by college:", JSON.stringify(byCollege));
}

async function runStepA() {
  const items = await loadFaculty();
  console.log(`facultyMembers scanned: ${items.length}`);
  const plan = await classify(items);
  printStepA(plan);
  const writes = [...plan.G, ...plan.P, ...plan.M];
  const counts = { G: plan.G.length, P: plan.P.length, M: plan.M.length };
  if (!APPLY) { console.log("\nDRY RUN - nothing written. Re-run with --apply --expect G=" + counts.G + ",P=" + counts.P + ",M=" + counts.M); return; }
  for (const k of ["G", "P", "M"]) if (EXPECT[k] !== counts[k]) throw new Error(`--expect ${k}=${EXPECT[k]} does not match the fresh plan (${counts[k]}) - aborting, nothing written`);
  if (plan.conflicts.length || plan.blocked.length) console.log("\nNOTE: conflicts/blocked docs exist - they are skipped, everything else proceeds.");

  ensureOut();
  const stamp = now();
  const untouchedBefore = await untouchedFingerprint();
  // Backup: every doc that has a `name` key (full document) + the manifest.
  const backup = {};
  for (const it of items) if ("name" in it.doc.data()) backup[it.doc.ref.path] = JSON.parse(JSON.stringify(norm(it.doc.data())));
  const backupFile = path.join(OUT_DIR, `backup-faculty-with-name-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  const manifest = {
    step: "A", createdAt: new Date().toISOString(), untouchedBefore, backupFile,
    docs: writes.map((w) => {
      const x = w.doc.data();
      return {
        path: w.doc.ref.path, employeeId: x.employeeId ?? null, class: w.write.nameAsPerPan !== undefined ? "G" : (x.candidateId || x.offerId ? "P" : "M"),
        original: { name: x.name ?? null, legalName: x.legalName ?? null, nameAsPerPan: x.nameAsPerPan ?? null },
        wrote: w.write, fingerprint: fingerprint(x), updatedAt: tsIso(x.updatedAt), updateTime: w.doc.updateTime.toDate().toISOString(),
      };
    }),
  };
  const manifestFile = path.join(OUT_DIR, `manifest-A-${stamp}.json`);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`\nBackup:   ${backupFile}\nManifest: ${manifestFile}`);

  let ok = 0, skipped = 0, failed = 0;
  for (const w of writes) {
    try { await w.doc.ref.update(w.write, { lastUpdateTime: w.doc.updateTime }); ok++; }
    catch (e) {
      if (e && (e.code === 9 || /FAILED_PRECONDITION/.test(String(e.message)))) { skipped++; console.log(`  SKIP ${w.label} edited concurrently - re-run to pick it up`); }
      else { failed++; console.error(`  FAIL ${w.label}: ${e.message ?? e}`); }
    }
  }
  console.log(`\nAPPLIED Step A: ${ok} written, ${skipped} skipped (concurrent edit), ${failed} failed.`);
  console.log(`Verify:  node scripts/migrate-faculty-name-model.mjs --verify "${manifestFile}"`);
  process.exit(failed > 0 ? 1 : 0);
}

// ─── verify (read-only) ─────────────────────────────────────────────────────
async function runVerify(manifestPath) {
  const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  let bad = 0;
  const say = (msg) => { bad++; console.log("  MISMATCH " + msg); };
  for (const e of m.docs) {
    const snap = await db.doc(e.path).get();
    if (!snap.exists) { say(`${e.employeeId}: doc missing`); continue; }
    const x = snap.data();
    if (fingerprint(x) !== e.fingerprint) say(`${e.employeeId}: a NON-name field changed`);
    if (tsIso(x.updatedAt) !== e.updatedAt) say(`${e.employeeId}: updatedAt changed`);
    if (e.wrote.nameAsPerPan !== undefined && trim(x.nameAsPerPan) !== e.wrote.nameAsPerPan) say(`${e.employeeId}: nameAsPerPan != ${JSON.stringify(e.wrote.nameAsPerPan)}`);
    if (e.wrote.legalName !== undefined) {
      if (trim(x.legalName) !== e.wrote.legalName) say(`${e.employeeId}: legalName != written value`);
      if (trim(x.nameAsPerPan)) say(`${e.employeeId}: nameAsPerPan present on a class ${e.class} record (must stay unset)`);
    }
  }
  const after = await untouchedFingerprint();
  for (const k of Object.keys(m.untouchedBefore)) {
    if (m.untouchedBefore[k].hash !== after[k].hash || m.untouchedBefore[k].count !== after[k].count) say(`${k} collection changed (${m.untouchedBefore[k].count} -> ${after[k].count} docs / hash differs)`);
  }
  const all = await loadFaculty();
  const withLegal = all.filter((i) => trim(i.doc.data().legalName)).length;
  const withPan = all.filter((i) => trim(i.doc.data().nameAsPerPan)).length;
  const withName = all.filter((i) => "name" in i.doc.data()).length;
  console.log(`\nfaculty total ${all.length} | legalName set ${withLegal} | nameAsPerPan set ${withPan} | still has legacy name ${withName}`);
  console.log(bad === 0 ? `VERIFIED: ${m.docs.length} manifest docs OK, no other field changed, users/systemUsers/supportingStaff untouched.` : `${bad} problem(s) found.`);
  process.exit(bad === 0 ? 0 : 1);
}

// ─── Step D (contract) ──────────────────────────────────────────────────────
async function runStepD(manifestPath) {
  if (!manifestPath) throw new Error("--step D needs --manifest <manifest-A.json>");
  const mA = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const byPath = new Map(mA.docs.map((d) => [d.path, d]));
  const items = await loadFaculty();
  const actions = []; const blocked = [];
  for (const it of items) {
    const x = it.doc.data();
    if (!("name" in x)) continue;
    const label = `${x.employeeId ?? it.doc.id} (${it.collegeName || (it.orphan ? "no college doc: " + it.collegeId.slice(0, 6) : it.collegeId)})`;
    const n = trim(x.name), l = trim(x.legalName), pan = trim(x.nameAsPerPan);
    const rec = byPath.get(it.doc.ref.path);
    if (!n) { actions.push({ ...it, label, kind: "E", update: { name: FieldValue.delete() }, savedName: str(x.name) }); continue; }
    if (!l) { blocked.push({ label, reason: "no legalName - `name` is still the only identity name; not deleted" }); continue; }
    // Class G: make sure the PAN value is safe before dropping `name`.
    if (!pan) { actions.push({ ...it, label, kind: "G+", update: { nameAsPerPan: n, name: FieldValue.delete() }, savedName: n }); continue; }
    if (pan === n) { actions.push({ ...it, label, kind: "done", update: { name: FieldValue.delete() }, savedName: n }); continue; }
    // Both set and different: use the Step A manifest to tell which side was edited since.
    if (rec && rec.wrote.nameAsPerPan !== undefined && pan === rec.wrote.nameAsPerPan && n !== rec.original.name?.trim()) {
      actions.push({ ...it, label, kind: "old-edit", update: { nameAsPerPan: n, name: FieldValue.delete() }, savedName: n, note: "name was edited by old code after Step A - nameAsPerPan refreshed" });
    } else {
      actions.push({ ...it, label, kind: "new-edit", update: { name: FieldValue.delete() }, savedName: n, note: "nameAsPerPan was edited after Step A - kept as is" });
    }
  }
  const counts = {}; for (const a of actions) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
  console.log(`\nStep D plan: delete legacy \`name\` on ${actions.length} docs  ${JSON.stringify(counts)}`);
  for (const a of actions.filter((x) => x.note)) console.log(`  ${a.label}: ${a.note}`);
  for (const b of blocked) console.log(`  BLOCKED ${b.label}: ${b.reason}`);
  if (!APPLY) { console.log(`\nDRY RUN - nothing written. Re-run with --apply --expect D=${actions.length}`); return; }
  if (EXPECT.D !== actions.length) throw new Error(`--expect D=${EXPECT.D} does not match the fresh plan (${actions.length}) - aborting, nothing written`);
  ensureOut();
  const stamp = now();
  const manifestD = { step: "D", createdAt: new Date().toISOString(), sourceManifest: manifestPath, deleted: actions.map((a) => ({ path: a.doc.ref.path, employeeId: a.doc.data().employeeId ?? null, name: a.doc.data().name, kind: a.kind, wroteNameAsPerPan: a.update.nameAsPerPan ?? null })) };
  const file = path.join(OUT_DIR, `manifest-D-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(manifestD, null, 2));
  console.log(`Manifest: ${file}`);
  let ok = 0, skipped = 0, failed = 0;
  for (const a of actions) {
    try { await a.doc.ref.update(a.update, { lastUpdateTime: a.doc.updateTime }); ok++; }
    catch (e) {
      if (e && (e.code === 9 || /FAILED_PRECONDITION/.test(String(e.message)))) { skipped++; console.log(`  SKIP ${a.label} edited concurrently`); }
      else { failed++; console.error(`  FAIL ${a.label}: ${e.message ?? e}`); }
    }
  }
  console.log(`\nAPPLIED Step D: ${ok} updated, ${skipped} skipped, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

// ─── rollback ───────────────────────────────────────────────────────────────
async function runRollback(manifestPath) {
  const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const plan = [];
  if (m.step === "A") {
    for (const e of m.docs) {
      const snap = await db.doc(e.path).get();
      if (!snap.exists) continue;
      const x = snap.data(); const update = {};
      // Only undo what Step A wrote, and only if the value is still exactly what it wrote.
      if (e.wrote.nameAsPerPan !== undefined && e.original.nameAsPerPan == null && trim(x.nameAsPerPan) === e.wrote.nameAsPerPan) update.nameAsPerPan = FieldValue.delete();
      if (e.wrote.legalName !== undefined && e.original.legalName == null && trim(x.legalName) === e.wrote.legalName) update.legalName = FieldValue.delete();
      if (Object.keys(update).length) plan.push({ snap, update, label: e.employeeId ?? e.path });
    }
  } else if (m.step === "D") {
    for (const e of m.deleted) {
      const snap = await db.doc(e.path).get();
      if (!snap.exists || "name" in snap.data()) continue;
      const update = { name: e.name };
      if (e.wroteNameAsPerPan != null && trim(snap.data().nameAsPerPan) === e.wroteNameAsPerPan && e.kind === "G+") update.nameAsPerPan = FieldValue.delete();
      plan.push({ snap, update, label: e.employeeId ?? e.path });
    }
  } else throw new Error("Unknown manifest");
  console.log(`Rollback of Step ${m.step}: ${plan.length} docs would be reverted.`);
  if (!APPLY) { console.log("DRY RUN - nothing written. Add --apply to revert."); return; }
  let ok = 0, failed = 0;
  for (const p of plan) {
    try { await p.snap.ref.update(p.update, { lastUpdateTime: p.snap.updateTime }); ok++; } catch (e) { failed++; console.error(`  FAIL ${p.label}: ${e.message ?? e}`); }
  }
  console.log(`Reverted ${ok}, failed ${failed}.`);
  process.exit(failed > 0 ? 1 : 0);
}

const rollbackPath = opt("--rollback");
const verifyPath = opt("--verify");
(async () => {
  if (rollbackPath) return runRollback(rollbackPath);
  if (verifyPath) return runVerify(verifyPath);
  if (STEP === "D") return runStepD(opt("--manifest"));
  return runStepA();
})().catch((e) => { console.error(e); process.exit(1); });
