/**
 * READ-ONLY. Backs up whole faculty records (colleges/{id}/facultyMembers/*, and the colleges/{id}/users/* logins that carry
 * an academicProfile) and later proves nothing in them changed. It never writes to Firestore.
 *
 *   node scripts/backup-faculty-records.mjs --list
 *        -> prints every college id + name
 *   node scripts/backup-faculty-records.mjs --colleges=<id>,<id> [--subs=students]
 *        -> writes backups/faculty-records-<timestamp>.json (kept out of git), re-reads Firestore, and checks the file
 *           against the live data document by document (count + sha256 of each canonical document)
 *   node scripts/backup-faculty-records.mjs --colleges=<id>,<id> --compare=<file.json>
 *        -> re-reads the same collections and reports every document/field that differs from that backup, separating
 *           "only the new optional qualification keys were added to a degree entry" (EXPECTED) from anything else
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const flag = (n) => process.argv.includes(`--${n}`);

if (!getApps().length) {
  initializeApp({ credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n"),
  }) });
}
const db = getFirestore();

// The qualification keys this feature adds to a degree entry. A compare treats only their appearance as expected.
const NEW_KEYS = new Set(["collegeType", "universityType", "universityTypeOther", "additionalInformation"]);

const plain = (v) => {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v?.toDate === "function") return { $date: v.toDate().toISOString() };
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, plain(v[k])]));
  return v;
};
const sha = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

if (flag("list")) {
  for (const d of (await db.collection("colleges").get()).docs) console.log(d.id, "|", d.data().name ?? "");
  process.exit(0);
}

const colleges = (arg("colleges") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
// Collections under each college to capture. Default (faculty work) unchanged; e.g. --subs=students for the student records.
const subs = (arg("subs") ?? "facultyMembers,users").split(",").map((s) => s.trim()).filter(Boolean);
if (!colleges.length) { console.error("usage: --list | --colleges=<id>,<id> [--compare=<file>]"); process.exit(1); }

async function capture() {
  const docs = {};
  for (const c of colleges) {
    const col = db.collection("colleges").doc(c);
    for (const sub of subs) {
      for (const d of (await col.collection(sub).get()).docs) {
        const data = d.data();
        // users: only the logins that hold an academicProfile mirror (everything else is not touched by this feature)
        if (sub === "users" && data.academicProfile === undefined) continue;
        docs[`colleges/${c}/${sub}/${d.id}`] = plain(data);
      }
    }
  }
  return docs;
}

const diffs = (a, b, path = "") => {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isO = (x) => x && typeof x === "object" && !Array.isArray(x) && !("$date" in x);
  if (isO(a) && isO(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => {
      if (!(k in a)) return [{ path: `${path}.${k}`, kind: "added", value: b[k] }];
      if (!(k in b)) return [{ path: `${path}.${k}`, kind: "removed", value: a[k] }];
      return diffs(a[k], b[k], `${path}.${k}`);
    });
  }
  return [{ path, kind: "changed", before: a, after: b }];
};

const here = dirname(fileURLToPath(import.meta.url));
const compareFile = arg("compare");

if (!compareFile) {
  const docs = await capture();
  const takenAt = new Date().toISOString();
  const file = join(here, "..", "backups", `${arg("subs") ? "records-" + subs.join("+") : "faculty-records"}-${takenAt.replace(/[:.]/g, "-")}.json`);
  mkdirSync(dirname(file), { recursive: true });
  const hashes = Object.fromEntries(Object.entries(docs).map(([p, v]) => [p, sha(v)]));
  writeFileSync(file, JSON.stringify({ takenAt, colleges, count: Object.keys(docs).length, hashes, docs }, null, 1));
  // Verify: parse the file back and re-read Firestore; every document must match byte for byte.
  const saved = JSON.parse(readFileSync(file, "utf8"));
  const live = await capture();
  const bad = [];
  if (saved.count !== Object.keys(live).length) bad.push(`count file=${saved.count} live=${Object.keys(live).length}`);
  for (const [p, v] of Object.entries(saved.docs)) if (sha(v) !== saved.hashes[p] || sha(live[p]) !== saved.hashes[p]) bad.push(p);
  const per = {};
  for (const p of Object.keys(saved.docs)) { const k = p.split("/").slice(0, 3).join("/"); per[k] = (per[k] ?? 0) + 1; }
  console.log("file:", file);
  console.log("documents:", saved.count, per);
  console.log(bad.length ? `VERIFY FAILED (${bad.length}): ${bad.slice(0, 10).join("; ")}` : "VERIFY OK: file matches live data, every document hash equal");
  process.exit(bad.length ? 2 : 0);
}

const saved = JSON.parse(readFileSync(compareFile, "utf8"));
const live = await capture();
const expected = [], unexpected = [];
for (const p of new Set([...Object.keys(saved.docs), ...Object.keys(live)])) {
  if (!(p in live)) { unexpected.push({ doc: p, kind: "document missing now" }); continue; }
  if (!(p in saved.docs)) { unexpected.push({ doc: p, kind: "document is new since backup (may be a legitimate new faculty)" }); continue; }
  for (const d of diffs(saved.docs[p], live[p])) {
    const last = d.path.split(".").pop();
    (d.kind === "added" && NEW_KEYS.has(last) ? expected : unexpected).push({ doc: p, ...d });
  }
}
console.log(`compared ${Object.keys(saved.docs).length} backed-up docs against ${Object.keys(live).length} live docs`);
console.log("expected (new optional keys added):", expected.length);
console.log("UNEXPECTED differences:", unexpected.length);
for (const u of unexpected.slice(0, 50)) console.log(" ", JSON.stringify(u).slice(0, 400));
process.exit(unexpected.length ? 3 : 0);
