/**
 * READ-ONLY backup of every collection the department-id migration may touch,
 * as JSONL (one doc per line, with a lossless Timestamp encoding), plus a
 * manifest.json (doc counts + sha256 per file). migrate-department-ids.mjs
 * --apply refuses to run without a manifest from this script.
 *
 * Firestore has no point-in-time recovery on this project (see the
 * employee-category incident), so this backup + the migration ledger are the
 * only way back.
 *
 * Usage:
 *   node scripts/backup-department-data.mjs                     # all colleges
 *   node scripts/backup-department-data.mjs --college <id>
 *   node scripts/backup-department-data.mjs --out <dir>
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Timestamp } from "firebase-admin/firestore";
import { DEFAULT_OUT_BASE, DEPARTMENT_REF_FIELDS, initDb, parseArgs, streamDocs, timestampDir } from "./lib/departmentRefs.mjs";

const args = parseArgs();
const db = initDb();
const outDir = args.values.out ? path.resolve(args.values.out) : timestampDir(path.join(DEFAULT_OUT_BASE, "backup"));
fs.mkdirSync(outDir, { recursive: true });

function encode(v) {
  if (v instanceof Timestamp) return { __ts: [v.seconds, v.nanoseconds] };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === "object") {
    if (typeof v.latitude === "number" && typeof v.longitude === "number" && Object.keys(v).length === 2) return { __geo: [v.latitude, v.longitude] };
    if (v.path && v.firestore) return { __ref: v.path };
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  }
  return v;
}

const collections = [...new Set([...DEPARTMENT_REF_FIELDS.map((e) => e.collection), "departments", "departmentKeys", "courses"])];
const colleges = args.values.college
  ? [await db.collection("colleges").doc(args.values.college).get()]
  : (await db.collection("colleges").get()).docs;

const manifest = { createdAt: new Date().toISOString(), files: {} };
for (const college of colleges) {
  if (!college.exists) continue;
  const dir = path.join(outDir, college.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const coll of collections) {
    const file = path.join(dir, `${coll}.jsonl`);
    const fd = fs.openSync(file, "w");
    const hash = crypto.createHash("sha256");
    let n = 0;
    for await (const doc of streamDocs(college.ref.collection(coll))) {
      const line = JSON.stringify({ id: doc.id, data: encode(doc.data()) }) + "\n";
      fs.writeSync(fd, line);
      hash.update(line);
      n++;
    }
    fs.closeSync(fd);
    if (n === 0) fs.unlinkSync(file);
    else manifest.files[`${college.id}/${coll}`] = { docs: n, sha256: hash.digest("hex") };
  }
  console.log(`backed up ${college.id} ${college.data()?.name ?? ""}`);
}
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`\nBackup written to ${outDir}\n  ${Object.keys(manifest.files).length} file(s), ${Object.values(manifest.files).reduce((a, f) => a + f.docs, 0)} doc(s)`);
