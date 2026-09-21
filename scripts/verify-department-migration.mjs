/**
 * READ-ONLY post-migration verification against the BEFORE fingerprint written
 * by audit-department-refs.mjs (fingerprint.json). Proves nothing was lost or
 * disconnected:
 *   1. Doc count per collection is unchanged (the migration never deletes/creates docs
 *      except departmentKeys lock docs).
 *   2. For every catalog field: the number of values that resolve to department D
 *      BY NAME BEFORE == the number of docs whose companion id field == D AFTER.
 *   3. Every id written points at a department that exists in that college, and
 *      (where the name still resolves) agrees with it.
 *   4. Every department has its name + code lock docs in departmentKeys.
 * Exit code 1 if any check fails.
 *
 * Usage:
 *   node scripts/verify-department-migration.mjs --fingerprint <audit-dir>/fingerprint.json [--college <id>]
 */

import fs from "node:fs";
import crypto from "node:crypto";
import {
  DEPARTMENT_REF_FIELDS, buildIndex, initDb, loadDepartments, loadMapping, normCode, normName, parseArgs, resolveValue, streamDocs,
} from "./lib/departmentRefs.mjs";

const args = parseArgs();
if (!args.values.fingerprint || !fs.existsSync(args.values.fingerprint)) { console.error("--fingerprint <fingerprint.json> required"); process.exit(1); }
const before = JSON.parse(fs.readFileSync(args.values.fingerprint, "utf8"));
const db = initDb();
const keyDocId = (field, raw) => `${field}_${crypto.createHash("sha256").update(field === "name" ? normName(raw) : normCode(raw)).digest("hex").slice(0, 40)}`;

const colleges = args.values.college ? [args.values.college] : Object.keys(before);
let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL ${msg}`); };

for (const collegeId of colleges) {
  const fp = before[collegeId];
  if (!fp) { console.log(`skip ${collegeId}: not in fingerprint`); continue; }
  const collegeRef = db.collection("colleges").doc(collegeId);
  const depts = await loadDepartments(collegeRef);
  const index = buildIndex(depts);
  const mapping = loadMapping(collegeId);
  console.log(`\n=== ${collegeId} ===`);

  const byCollection = new Map();
  for (const e of DEPARTMENT_REF_FIELDS) (byCollection.get(e.collection) ?? byCollection.set(e.collection, []).get(e.collection)).push(e);

  const after = {}; // deptId -> "collection.field" -> count of docs carrying that id
  for (const [collection, entries] of byCollection) {
    let n = 0;
    for await (const doc of streamDocs(collegeRef.collection(collection))) {
      n++;
      const data = doc.data();
      for (const e of entries) {
        const tally = (idVal, nameVal, label) => {
          if (idVal === undefined || idVal === null || idVal === "") return;
          if (!index.byId.has(idVal)) { fail(`${collection}/${doc.id} ${label}: id ${idVal} is not a department of this college`); return; }
          if (typeof nameVal === "string" && nameVal.trim()) {
            const r = resolveValue(index, nameVal, mapping);
            if (r.ok && r.id !== idVal) fail(`${collection}/${doc.id} ${label}: id ${idVal} disagrees with name "${nameVal}"`);
          }
          const key = `${collection}.${e.field}`;
          ((after[idVal] ??= {})[key] = (after[idVal][key] ?? 0) + 1);
        };
        if (e.kind === "scalar") tally(data[e.idField], data[e.field], e.field);
        else if (e.kind === "array" && Array.isArray(data[e.idField])) data[e.idField].forEach((id, i) => tally(id, (data[e.field] ?? [])[i], `${e.field}[${i}]`));
        else if (e.kind === "nestedScopes") {
          for (const [cat, scope] of Object.entries(data.courseScopes ?? {})) {
            (scope?.secondaryDepartmentIds ?? []).forEach((id, i) => tally(id, (scope.secondaryDepartments ?? [])[i], `courseScopes.${cat}[${i}]`));
          }
        }
      }
    }
    const was = fp.collections[collection];
    if (was !== undefined && was !== n) fail(`${collection}: doc count ${was} -> ${n}`);
  }

  // Per-department counts: what resolved to D by name before must now carry D's id.
  // (Values that stayed unresolved were quarantined on purpose and are not counted here.)
  for (const [deptId, keys] of Object.entries(fp.perDepartment)) {
    for (const [key, wasCount] of Object.entries(keys)) {
      const nowCount = after[deptId]?.[key] ?? 0;
      if (nowCount !== wasCount) fail(`${key} for department ${deptId} (${index.byId.get(deptId)?.name ?? "?"}): by-name before ${wasCount} != by-id now ${nowCount}`);
    }
  }

  // Uniqueness lock docs.
  for (const d of depts) {
    for (const field of ["name", "code"]) {
      if (!d[field]) continue;
      const snap = await collegeRef.collection("departmentKeys").doc(keyDocId(field, d[field])).get();
      if (!snap.exists) fail(`department ${d.id} (${d.name}) missing ${field} lock doc`);
      else if (snap.data().departmentId !== d.id) fail(`department ${d.id} ${field} lock is owned by ${snap.data().departmentId}`);
    }
  }
  console.log(failures ? "  (see FAIL lines above)" : "  OK");
}
console.log(failures ? `\n${failures} verification failure(s)` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
