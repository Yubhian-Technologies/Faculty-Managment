/**
 * READ-ONLY audit of every place a department is referenced by NAME, per college.
 * Nothing is written to Firestore. Reads are UNCAPPED (id-ordered pagination).
 *
 * For each college it reports:
 *   1. Uniqueness of the departments themselves: duplicate normalised names /
 *      codes, a name equal to another department's code, blank codes.
 *   2. For every field in DEPARTMENT_REF_FIELDS: how each stored value resolves
 *      (exact | case_or_spacing | code | mapping | blank | ambiguous | none) and,
 *      where a `departmentId` already sits beside it, whether it is consistent
 *      (id_ok | id_dangling | id_conflict | id_missing).
 *   3. Discovery: any field whose key contains "depart" on ANY collection that is
 *      NOT in the catalog (so a forgotten collection is surfaced, not skipped).
 *   4. The BEFORE fingerprint: doc count per collection and per-department doc
 *      counts (by resolved id) - verify-department-migration.mjs compares to it.
 *
 * Output (outside the repo by default): <out>/<timestamp>/
 *   summary.json, unresolved.csv (everything that is NOT exact/id_ok), fingerprint.json
 *
 * Usage:
 *   node scripts/audit-department-refs.mjs
 *   node scripts/audit-department-refs.mjs --college <collegeId>
 *   node scripts/audit-department-refs.mjs --no-discovery      # skip the non-catalog collection sweep
 *   node scripts/audit-department-refs.mjs --out <dir>
 */

import fs from "node:fs";
import path from "node:path";
import {
  DEPARTMENT_REF_FIELDS, DEFAULT_OUT_BASE, DISCOVERY_IGNORE, DISCOVERY_IGNORE_KEYS, buildIndex, canonName, initDb, loadDepartments,
  loadMapping, normCode, normName, parseArgs, resolveValue, streamDocs, timestampDir, writeCsv,
} from "./lib/departmentRefs.mjs";

const args = parseArgs();
const db = initDb();
const outDir = args.values.out ? path.resolve(args.values.out) : timestampDir(DEFAULT_OUT_BASE);
fs.mkdirSync(outDir, { recursive: true });

function uniquenessReport(depts) {
  const issues = [];
  const names = new Map();
  const codes = new Map();
  for (const d of depts) {
    const n = normName(d.name);
    const c = normCode(d.code);
    if (!n) issues.push({ kind: "blank_name", ids: [d.id] });
    if (!c) issues.push({ kind: "blank_code", ids: [d.id], name: d.name });
    if (n) (names.get(n) ?? names.set(n, []).get(n)).push(d.id);
    if (c) (codes.get(c) ?? codes.set(c, []).get(c)).push(d.id);
  }
  for (const [k, ids] of names) if (ids.length > 1) issues.push({ kind: "duplicate_name", key: k, ids });
  for (const [k, ids] of codes) if (ids.length > 1) issues.push({ kind: "duplicate_code", key: k, ids });
  for (const d of depts) {
    const asCode = normCode(d.name);
    for (const o of depts) {
      if (o.id !== d.id && asCode && asCode === normCode(o.code)) issues.push({ kind: "name_equals_other_code", ids: [d.id, o.id], value: d.name });
    }
  }
  return issues;
}

function classify(index, mapping, raw, canonicalNameOfResolved) {
  const r = resolveValue(index, raw, mapping);
  if (!r.ok) return { cls: r.reason, r };
  if (r.via === "mapping") return { cls: "mapping", r };
  if (r.via === "code") return { cls: "code", r };
  if (r.via === "id") return { cls: "id_as_value", r };
  return { cls: String(raw).trim() === canonicalNameOfResolved(r.id) && raw === canonName(raw) ? "exact" : "case_or_spacing", r };
}

const colleges = args.values.college
  ? [await db.collection("colleges").doc(args.values.college).get()]
  : (await db.collection("colleges").get()).docs;

const summary = { generatedAt: new Date().toISOString(), colleges: {} };
const fingerprint = {};
const unresolvedRows = [];

for (const college of colleges) {
  if (!college.exists) { console.error(`college ${college.id} not found`); continue; }
  const collegeRef = college.ref;
  const depts = await loadDepartments(collegeRef);
  const index = buildIndex(depts);
  const mapping = loadMapping(college.id);
  const nameOfId = (id) => index.byId.get(id)?.name ?? "";
  const cSum = {
    name: college.data()?.name ?? "",
    departmentCount: depts.length,
    uniquenessIssues: uniquenessReport(depts),
    mappingEntries: mapping.size,
    fields: {},
    discovery: {},
  };
  const fp = { collections: {}, perDepartment: {} };
  console.log(`\n=== ${college.id} ${cSum.name} (${depts.length} departments) ===`);
  if (cSum.uniquenessIssues.length) console.log(`  !! ${cSum.uniquenessIssues.length} department uniqueness issue(s)`);

  // Group catalog entries by collection so each collection is streamed once.
  const byCollection = new Map();
  for (const e of DEPARTMENT_REF_FIELDS) (byCollection.get(e.collection) ?? byCollection.set(e.collection, []).get(e.collection)).push(e);

  for (const [collection, entries] of byCollection) {
    let docCount = 0;
    const stats = new Map(entries.map((e) => [`${e.field}`, { field: e.field, idField: e.idField, kind: e.kind, values: 0, classes: {}, idStates: {} }]));
    for await (const doc of streamDocs(collegeRef.collection(collection))) {
      docCount++;
      const data = doc.data();
      for (const e of entries) {
        const st = stats.get(e.field);
        const record = (raw, idVal, label) => {
          st.values++;
          const { cls, r } = classify(index, mapping, raw, nameOfId);
          st.classes[cls] = (st.classes[cls] ?? 0) + 1;
          if (r.ok) {
            const key = `${collection}.${e.field}`;
            const fpDept = (fp.perDepartment[r.id] ??= {});
            fpDept[key] = (fpDept[key] ?? 0) + 1;
          }
          let idState = "id_missing";
          if (idVal !== undefined && idVal !== null && idVal !== "") {
            if (!index.byId.has(idVal)) idState = "id_dangling";
            else if (r.ok && r.id !== idVal) idState = "id_conflict";
            else idState = "id_ok";
          }
          st.idStates[idState] = (st.idStates[idState] ?? 0) + 1;
          if (!["exact"].includes(cls) || idState === "id_dangling" || idState === "id_conflict") {
            unresolvedRows.push({
              college: college.id, collection, docId: doc.id, field: label, value: raw, class: cls, idState,
              resolvedId: r.ok ? r.id : "", candidates: r.candidates ? r.candidates.join("|") : "",
            });
          }
        };
        if (e.kind === "scalar") {
          const raw = data[e.field];
          if (raw === undefined || raw === null) continue;
          if (typeof raw !== "string") continue;
          if (!raw.trim()) { st.values++; st.classes.blank = (st.classes.blank ?? 0) + 1; continue; }
          record(raw, data[e.idField], e.field);
        } else if (e.kind === "array") {
          const arr = data[e.field];
          if (!Array.isArray(arr)) continue;
          const ids = Array.isArray(data[e.idField]) ? data[e.idField] : [];
          arr.forEach((raw, i) => { if (typeof raw === "string") record(raw, ids[i], `${e.field}[${i}]`); });
        } else if (e.kind === "nestedScopes") {
          for (const [catalogId, scope] of Object.entries(data.courseScopes ?? {})) {
            const arr = scope?.secondaryDepartments;
            if (!Array.isArray(arr)) continue;
            const ids = Array.isArray(scope.secondaryDepartmentIds) ? scope.secondaryDepartmentIds : [];
            arr.forEach((raw, i) => { if (typeof raw === "string") record(raw, ids[i], `courseScopes.${catalogId}.secondaryDepartments[${i}]`); });
          }
        }
      }
    }
    fp.collections[collection] = docCount;
    for (const st of stats.values()) {
      cSum.fields[`${collection}.${st.field}`] = { docs: docCount, ...st };
      if (st.values) console.log(`  ${collection}.${st.field}: ${st.values} value(s) ${JSON.stringify(st.classes)} ${JSON.stringify(st.idStates)}`);
    }
  }

  // Discovery pass: any "depart*" field on a collection outside the catalog.
  if (!args.flags.has("no-discovery")) {
    const cataloged = new Set(DEPARTMENT_REF_FIELDS.map((e) => e.collection));
    const knownKeys = new Set(DEPARTMENT_REF_FIELDS.flatMap((e) => [e.field, e.idField]));
    for (const coll of await collegeRef.listCollections()) {
      if (DISCOVERY_IGNORE.has(coll.id)) continue;
      const found = {};
      let docs = 0;
      for await (const doc of streamDocs(coll)) {
        docs++;
        for (const [k, v] of Object.entries(doc.data())) {
          if (!/depart/i.test(k) || DISCOVERY_IGNORE_KEYS.has(k)) continue;
          if (cataloged.has(coll.id) && knownKeys.has(k)) continue;
          if (typeof v === "string" || Array.isArray(v) || (v && typeof v === "object")) found[k] = (found[k] ?? 0) + 1;
        }
      }
      if (!cataloged.has(coll.id)) fp.collections[coll.id] = docs;
      if (Object.keys(found).length) {
        cSum.discovery[coll.id] = found;
        console.log(`  discovery ${coll.id}: ${JSON.stringify(found)}`);
      }
    }
  }

  summary.colleges[college.id] = cSum;
  fingerprint[college.id] = fp;
}

fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(outDir, "fingerprint.json"), JSON.stringify(fingerprint, null, 2));
writeCsv(path.join(outDir, "unresolved.csv"), unresolvedRows, ["college", "collection", "docId", "field", "value", "class", "idState", "resolvedId", "candidates"]);
console.log(`\nWrote ${outDir}\n  ${unresolvedRows.length} non-exact/unresolved row(s) in unresolved.csv`);
