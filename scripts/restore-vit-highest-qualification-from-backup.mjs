/**
 * Restores every VIT faculty member's Highest Qualification FROM THE BACKUP
 * written by scripts/standardize-vit-highest-qualification.mjs (their original
 * raw `qualification` values), normalized to the fixed category list - never
 * from the current migrated values, and never re-introducing the raw variants.
 *
 *   Ph.D, M.Tech, M.E, M.Sc, M.A, M.Phil, M.P.Ed, MSIT, MBA, B.Tech, B.Sc, Others
 *
 * Classification = src/lib/faculty/highestQualification.ts (same function the
 * forms and API routes use). Multi-degree originals resolve to the highest;
 * anything unmappable becomes "Others" and its original text is kept (it is
 * the stored value, exactly as the Others free-text box saves it).
 *
 * Records not in the backup (it only holds docs that needed a write) fall back
 * to their current highestQualification, which was already standardized.
 *
 * Only `highestQualification` (and a leftover legacy `qualification`) are ever
 * written. `academicProfile.highestQualification` and every other field are
 * untouched - proven by hashing every other field before and after.
 *
 * Usage: node scripts/restore-vit-highest-qualification-from-backup.mjs --backup <file>            (dry run)
 *        node scripts/restore-vit-highest-qualification-from-backup.mjs --backup <file> --apply
 */

import "dotenv/config";
import fs from "node:fs";
import crypto from "node:crypto";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { classifyHighestQualification, HIGHEST_QUALIFICATION_OPTIONS } from "../src/lib/faculty/highestQualification.ts";

const APPLY = process.argv.includes("--apply");
const argAfter = (flag) => { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : null; };
const BACKUP = argAfter("--backup");
const COLLEGE_NAME = argAfter("--college") ?? "VISHNU INSTITUTE OF TECHNOLOGY";
if (!BACKUP) { console.error("--backup <file> is required"); process.exit(1); }

const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
const privateKey = rawKey.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
if (!getApps().length) {
  initializeApp({ credential: cert({ projectId: process.env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey }) });
}
const db = getFirestore();
const CATEGORIES = [...HIGHEST_QUALIFICATION_OPTIONS];
const isBlank = (v) => typeof v !== "string" || v.trim() === "";

const backup = JSON.parse(fs.readFileSync(BACKUP, "utf8"));
const backupById = new Map(backup.map((e) => [e.id, e]));

// Hash of every field EXCEPT the two qualification keys - to prove nothing else moved.
function otherFieldsHash(data) {
  const { qualification: _q, highestQualification: _h, ...rest } = data;
  const sortDeep = (v) => Array.isArray(v) ? v.map(sortDeep)
    : v && typeof v === "object" && !(v instanceof Date) && typeof v.toDate !== "function"
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]))
      : v && typeof v.toDate === "function" ? `ts:${v.toDate().toISOString()}` : v;
  return crypto.createHash("sha256").update(JSON.stringify(sortDeep(rest))).digest("hex");
}

async function run() {
  const colleges = (await db.collection("colleges").get()).docs.filter((c) => (c.data().name ?? "").trim().toLowerCase() === COLLEGE_NAME.toLowerCase());
  if (colleges.length !== 1) throw new Error(`Expected exactly one college "${COLLEGE_NAME}", found ${colleges.length}`);
  const college = colleges[0];
  const docs = (await college.ref.collection("facultyMembers").get()).docs;
  console.log(`College: ${college.id} (${college.data().name}) - ${docs.length} faculty; backup entries: ${backup.length}`);

  const rows = docs.map((doc) => {
    const d = doc.data();
    const b = backupById.get(doc.id);
    const originalRaw = b ? (b.before.qualification ?? b.before.highestQualification) : (d.highestQualification ?? d.qualification);
    const cls = classifyHighestQualification(originalRaw);
    return { doc, id: doc.id, employeeId: d.employeeId ?? doc.id, fromBackup: !!b, originalRaw, final: cls.value, category: cls.category, ambiguous: cls.ambiguous, hashBefore: otherFieldsHash(d),
      needsWrite: !!cls.value && (d.highestQualification !== cls.value || "qualification" in d) };
  });

  const toWrite = rows.filter((r) => r.needsWrite);
  console.log(`Restore plan: ${rows.filter((r) => r.fromBackup).length} from backup, ${rows.filter((r) => !r.fromBackup).length} not in backup (current value used); ${toWrite.length} need a write.`);
  for (const r of toWrite.slice(0, 20)) console.log(`  ${r.employeeId}: ${JSON.stringify(r.originalRaw)} -> ${r.final}`);

  let written = 0;
  if (APPLY) {
    for (const r of toWrite) {
      const updates = { highestQualification: r.final };
      if ("qualification" in r.doc.data()) updates.qualification = FieldValue.delete();
      await r.doc.ref.update(updates, { lastUpdateTime: r.doc.updateTime });
      written++;
    }
    console.log(`APPLIED: ${written} write(s).`);
  } else {
    console.log("DRY RUN - pass --apply to write.");
  }

  // ---- Verification: re-read Firestore ----
  const after = (await college.ref.collection("facultyMembers").get()).docs;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const counts = new Map(CATEGORIES.map((c) => [c, 0]));
  const others = [], notInList = [], missing = [], legacy = [], changedOther = [], notOne = [];
  for (const doc of after) {
    const d = doc.data();
    const v = d.highestQualification;
    if (isBlank(v)) { missing.push(doc.id); continue; }
    if (typeof v !== "string") notOne.push(doc.id);
    if ("qualification" in d) legacy.push(doc.id);
    if (counts.has(v)) counts.set(v, counts.get(v) + 1);
    else {
      const cls = classifyHighestQualification(v);
      if (cls.category === "Others") others.push({ id: byId.get(doc.id)?.employeeId ?? doc.id, stored: v, original: byId.get(doc.id)?.originalRaw });
      else notInList.push({ id: doc.id, v });
    }
    if (byId.get(doc.id) && otherFieldsHash(d) !== byId.get(doc.id).hashBefore) changedOther.push(doc.id);
  }
  const ok = counts.size ? [...counts.values()].reduce((a, b) => a + b, 0) : 0;

  console.log("\n===== VERIFICATION (re-read from Firestore) =====");
  console.log(`1. VIT faculty checked: ${after.length}`);
  console.log(`2. Faculty with exactly one non-blank string highestQualification: ${after.length - missing.length - notOne.length} (missing: ${missing.length}, non-string: ${notOne.length})`);
  console.log(`3. Values in the fixed list: ${ok}; "Others" free-text: ${others.length}; anything else (must be 0): ${notInList.length}`);
  console.log(`4. Raw variants remaining (values that would normalize to a category but aren't canonical): ${notInList.length}`);
  console.log("5. Final count per category:");
  for (const [c, n] of counts) console.log(`     ${c.padEnd(8)} ${n}`);
  console.log(`     ${"Others".padEnd(8)} ${others.length}`);
  console.log(`6. Records mapped to Others: ${others.length}`);
  for (const o of others) console.log(`     ${o.id}: original ${JSON.stringify(o.original)} -> stored ${JSON.stringify(o.stored)}`);
  console.log(`7. Docs whose OTHER fields (incl. academicProfile) changed: ${changedOther.length} (must be 0)`);
  console.log(`   Docs still holding legacy \`qualification\`: ${legacy.length}`);
  process.exit(missing.length || notOne.length || notInList.length || changedOther.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
