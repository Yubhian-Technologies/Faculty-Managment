/**
 * Moves the three shared root-level Roles/Responsibilities fields of
 * `academicProfile` onto the experience entries they describe:
 *
 *   teachingRolesResponsibilities  (legacy: teachingAssignment.primaryTeachingRole)
 *                                   -> academicExperience[latest].rolesResponsibilities
 *   industryRolesResponsibilities  (legacy: primaryIndustryRole)
 *                                   -> industryExperience[latest].rolesResponsibilities
 *   researchRolesResponsibilities  (legacy: primaryResearchRole)
 *                                   -> researchExperience[latest].rolesResponsibilities
 *
 * "latest" = the entry with no end date (ongoing), else the latest end date, then start
 * date, ties -> later in the list. Mirrors latestEntryIndex() in src/lib/faculty/fieldRenames.ts,
 * which lifts the same way at read time for documents this script has not reached yet.
 * A list still stored under its legacy name (previousInstitutions / ...Entries) is updated
 * in place under that name - renaming keys is migrate-faculty-field-names.mjs's job.
 *
 * Safeguards:
 *   - DRY RUN by default: prints the plan, writes nothing anywhere.
 *   - --apply first writes a full JSON backup of every document it will touch to
 *     backups/experience-roles-<timestamp>.json, re-reads it to check it, and aborts if that fails.
 *   - Phase 1 (--apply) ONLY ADDS `rolesResponsibilities` to one entry per list. The old root
 *     fields are left in place, so nothing is lost and it is trivially reversible.
 *   - Every write carries a lastUpdateTime precondition: a document edited by someone else
 *     between the read and the write is skipped (and reported), never overwritten.
 *   - After writing, every document is re-read and verified: entry counts unchanged, every
 *     other entry field byte-identical, only the intended entry gained the text, every
 *     other academicProfile key unchanged. Any failure prints FAIL and exits 1.
 *   - Never assigns text it can't place: no entries -> reported as ORPHAN and left; latest
 *     entry already has different text -> reported as CONFLICT and left.
 *   - Phase 2 (--apply --delete-legacy, run only after phase 1 verified clean) deletes a
 *     legacy root field only when an entry holds exactly its text. Also backed up first.
 *   - --verify: read-only re-check of the whole database (no writes).
 *
 * Usage: node scripts/migrate-experience-roles-into-entries.mjs                        (dry run)
 *        node scripts/migrate-experience-roles-into-entries.mjs --apply                (phase 1)
 *        node scripts/migrate-experience-roles-into-entries.mjs --verify               (read-only)
 *        node scripts/migrate-experience-roles-into-entries.mjs --apply --delete-legacy (phase 2)
 *   optional: --college <collegeId>
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const VERIFY = process.argv.includes("--verify");
const DELETE_LEGACY = process.argv.includes("--delete-legacy");
if (DELETE_LEGACY && !APPLY) {
  console.error("--delete-legacy only makes sense together with --apply");
  process.exit(2);
}
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

const KINDS = [
  { name: "academic", listKeys: ["academicExperience", "previousInstitutions"], sources: ["teachingRolesResponsibilities", "teachingAssignment.primaryTeachingRole"] },
  { name: "industry", listKeys: ["industryExperience", "industryExperienceEntries"], sources: ["industryRolesResponsibilities", "primaryIndustryRole"] },
  { name: "research", listKeys: ["researchExperience", "researchExperienceEntries"], sources: ["researchRolesResponsibilities", "primaryResearchRole"] },
];

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";
const getPath = (o, p) => p.split(".").reduce((a, k) => (isObj(a) ? a[k] : undefined), o);
const stable = (v) => JSON.stringify(sortDeep(v));
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, sortDeep(v[k])]));
  return v;
}

// --- mirrors latestEntryIndex() in src/lib/faculty/fieldRenames.ts ---
const endKey = (e) => (nonEmpty(e.toDate) ? e.toDate : e.toYear ? `${e.toYear}-01-01` : "") || "9999-12-31";
const startKey = (e) => (nonEmpty(e.fromDate) ? e.fromDate : e.fromYear ? `${e.fromYear}-01-01` : "");
function latestEntryIndex(entries) {
  let best = -1;
  entries.forEach((raw, i) => {
    const e = isObj(raw) ? raw : {};
    if (best === -1) { best = i; return; }
    const b = entries[best];
    const [ek, bk, es, bs] = [endKey(e), endKey(b), startKey(e), startKey(b)];
    if (ek > bk || (ek === bk && es >= bs)) best = i;
  });
  return best;
}

// Per document: which lists get a new rolesResponsibilities, and which legacy sources an
// entry already fully covers (deletable in phase 2).
function plan(ap) {
  const out = { writes: {}, deletable: [], notes: [] };
  for (const kind of KINDS) {
    // A current-name list wins over a legacy-name one, as in migrateAcademicProfile.
    const listKey = kind.listKeys.find((k) => k in ap) ?? kind.listKeys[0];
    const list = ap[listKey];
    const candidates = kind.sources.map((p) => ({ path: p, text: getPath(ap, p) })).filter((c) => nonEmpty(c.text));
    if (candidates.length === 0) continue;
    const chosen = candidates[0];
    for (const alt of candidates.slice(1)) {
      if (alt.text.trim() !== chosen.text.trim()) out.notes.push(`${kind.name}: ${alt.path} differs from ${chosen.path} - left in place`);
    }
    if (!Array.isArray(list) || list.length === 0) {
      out.notes.push(`ORPHAN ${kind.name}: text in ${chosen.path} but no entries - left untouched`);
      continue;
    }
    const idx = latestEntryIndex(list);
    const target = list[idx];
    const existing = isObj(target) ? target.rolesResponsibilities : undefined;
    if (nonEmpty(existing)) {
      if (existing.trim() === chosen.text.trim()) {
        for (const c of candidates) if (c.text.trim() === existing.trim()) out.deletable.push({ kind: kind.name, path: c.path });
      } else {
        out.notes.push(`CONFLICT ${kind.name}: latest entry already has different text - left untouched`);
      }
      continue;
    }
    if (!isObj(target)) continue;
    out.writes[listKey] = list.map((e, i) => (i === idx ? { ...e, rolesResponsibilities: chosen.text } : e));
    out.notes.push(`${kind.name}: ${chosen.path} -> ${listKey}[${idx}]${list.length > 1 ? ` (latest of ${list.length})` : ""}`);
    for (const c of candidates) if (c.text.trim() === chosen.text.trim()) out.deletable.push({ kind: kind.name, path: c.path });
  }
  return out;
}

// Re-read check for one document after a write. Returns a list of problems (empty = ok).
function verifyDoc(before, after, expectedWrites, deleted) {
  const problems = [];
  const deletedSet = new Set(deleted);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (k in expectedWrites) {
      const b = before[k], a = after[k];
      if (!Array.isArray(a) || a.length !== b.length) { problems.push(`${k}: entry count changed`); continue; }
      const idx = latestEntryIndex(b);
      b.forEach((be, i) => {
        const { rolesResponsibilities: br, ...brest } = be;
        const { rolesResponsibilities: ar, ...arest } = a[i] ?? {};
        if (stable(brest) !== stable(arest)) problems.push(`${k}[${i}]: other fields changed`);
        if (i === idx) { if (ar !== expectedWrites[k][i].rolesResponsibilities) problems.push(`${k}[${i}]: roles text wrong`); }
        else if (br !== ar) problems.push(`${k}[${i}]: roles text changed on a non-target entry`);
      });
    } else if (k === "teachingAssignment" && deletedSet.has("teachingAssignment.primaryTeachingRole")) {
      const { primaryTeachingRole, ...rest } = before[k] ?? {};
      if (stable(rest) !== stable(after[k] ?? {})) problems.push("teachingAssignment: unexpected change");
    } else if (deletedSet.has(k)) {
      if (k in after) problems.push(`${k}: expected deleted`);
    } else if (stable(before[k]) !== stable(after[k])) {
      problems.push(`${k}: unexpectedly changed`);
    }
  }
  return problems;
}

async function loadAll() {
  const docs = [];
  for (const coll of ["facultyMembers", "users"]) {
    const snap = await db.collectionGroup(coll).get();
    for (const d of snap.docs) {
      if (COLLEGE_FILTER && d.ref.path.split("/")[1] !== COLLEGE_FILTER) continue;
      const ap = d.data().academicProfile;
      if (isObj(ap)) docs.push({ doc: d, ap });
    }
  }
  return docs;
}

async function run() {
  const all = await loadAll();
  console.log(`Scanned ${all.length} documents with an academicProfile${COLLEGE_FILTER ? ` (college ${COLLEGE_FILTER})` : ""}.`);
  const items = all.map(({ doc, ap }) => ({ doc, ap, p: plan(ap) }));
  const label = (d) => `${d.data().employeeId ?? d.id} [${d.ref.path}]`;

  if (VERIFY) {
    let bad = 0, pending = 0, legacyLeft = 0;
    for (const { doc, ap, p } of items) {
      if (Object.keys(p.writes).length) { pending++; console.log(`PENDING ${label(doc)}: ${p.notes.join("; ")}`); }
      for (const n of p.notes) if (/^(ORPHAN|CONFLICT)/.test(n)) console.log(`NEEDS REVIEW ${label(doc)}: ${n}`);
      for (const kind of KINDS) for (const s of kind.sources) if (nonEmpty(getPath(ap, s))) legacyLeft++;
      for (const kind of KINDS) for (const k of kind.listKeys) {
        if (Array.isArray(ap[k]) && ap[k].some((e) => !isObj(e))) { bad++; console.log(`FAIL ${label(doc)}: ${k} has a non-object entry`); }
      }
    }
    console.log(`\nVerify: ${pending} document(s) still to migrate, ${legacyLeft} legacy root field(s) still present, ${bad} structural problem(s).`);
    process.exit(bad ? 1 : 0);
  }

  // What each pending write/delete would do.
  const targets = items.filter(({ p }) => (DELETE_LEGACY ? p.deletable.length > 0 : Object.keys(p.writes).length > 0));
  for (const { doc, p } of items) {
    if (!p.notes.length) continue;
    console.log(`${APPLY ? "" : "PLAN "}${label(doc)}`);
    for (const n of p.notes) console.log(`    ${n}`);
  }
  console.log(`\n${targets.length} document(s) ${DELETE_LEGACY ? "have legacy fields safe to delete" : "will be written"}.`);
  if (!APPLY) { console.log("Dry run - nothing written. Re-run with --apply to migrate (a backup is taken first)."); return; }
  if (targets.length === 0) return;

  // --- backup, checked before any write ---
  const dir = path.resolve("backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `experience-roles-${DELETE_LEGACY ? "delete-legacy-" : ""}${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const backup = targets.map(({ doc, ap }) => ({ path: doc.ref.path, updateTime: doc.updateTime.toDate().toISOString(), academicProfile: ap }));
  fs.writeFileSync(file, JSON.stringify(backup, null, 1));
  const reread = JSON.parse(fs.readFileSync(file, "utf8"));
  if (reread.length !== targets.length || stable(reread.map((b) => b.academicProfile)) !== stable(targets.map((t) => t.ap))) {
    console.error("Backup verification failed - aborting, nothing was written.");
    process.exit(1);
  }
  console.log(`Backup written and verified: ${file}`);

  let written = 0, skipped = 0, failed = 0;
  for (const { doc, ap, p } of targets) {
    const update = {};
    const deleted = [];
    if (DELETE_LEGACY) {
      for (const d of p.deletable) { update[`academicProfile.${d.path}`] = FieldValue.delete(); deleted.push(d.path); }
    } else {
      for (const [k, v] of Object.entries(p.writes)) update[`academicProfile.${k}`] = v;
    }
    try {
      await doc.ref.update(update, { lastUpdateTime: doc.updateTime });
    } catch (e) {
      skipped++;
      console.log(`SKIP ${label(doc)}: ${e.code === 9 || /precondition/i.test(e.message) ? "changed since it was read" : e.message}`);
      continue;
    }
    written++;
    const after = (await doc.ref.get()).data().academicProfile ?? {};
    const problems = verifyDoc(ap, after, DELETE_LEGACY ? {} : p.writes, deleted);
    if (problems.length) { failed++; console.log(`FAIL ${label(doc)}: ${problems.join("; ")}`); }
  }
  console.log(`\nDone: ${written} written, ${skipped} skipped (re-run to retry), ${failed} FAILED verification.`);
  if (failed) { console.log(`Restore from ${file} if needed.`); process.exit(1); }
}

run().catch((e) => { console.error(e); process.exit(1); });
