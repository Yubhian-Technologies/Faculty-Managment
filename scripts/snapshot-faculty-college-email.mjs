/**
 * READ-ONLY. Saves everything the system holds about ONE faculty member (by Employee ID) so a college-email change can be
 * checked afterwards, and compares a later state with that saved snapshot. It never writes to Firestore or Auth.
 *
 *   node scripts/snapshot-faculty-college-email.mjs --college=<collegeId> --employee=<EmployeeID>
 *        -> writes backups/faculty-<emp>-<timestamp>.json (kept out of git) and prints a summary
 *   node scripts/snapshot-faculty-college-email.mjs --college=<collegeId> --employee=<EmployeeID> --compare=<file.json>
 *        -> re-reads the same data and reports every difference, separating the ones a college-email change is EXPECTED to
 *           make (the email fields, updatedAt, history marker, sign-out stamp, new audit/notification entries) from anything else.
 *
 * Captured: the faculty record, the login (users), systemUsers, the Firebase Auth user (email, claims, disabled, providers -
 * never the password), the Employee-ID lock docs, and every document in every collection of the college that refers to the
 * person through the usual id fields (facultyId / uid / employeeId / ...), found with plain equality queries.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const collegeId = arg("college");
const employee = arg("employee");
const compareFile = arg("compare");
if (!collegeId || !employee) { console.error("usage: --college=<id> --employee=<EmployeeID> [--compare=<file>]"); process.exit(1); }

if (!getApps().length) {
  initializeApp({ credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n"),
  }) });
}
const db = getFirestore();
const auth = getAuth();
const college = db.collection("colleges").doc(collegeId);

// Firestore values -> plain JSON (Timestamps as ISO strings) so snapshots can be compared as text.
const plain = (v) => {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v?.toDate === "function") return { $date: v.toDate().toISOString() };
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, plain(v[k])]));
  return v;
};

const ID_FIELDS = ["facultyId", "facultyUid", "uid", "userUid", "toUid", "fromUid", "requesterUid", "requestedByUid", "performedBy", "targetId", "holderUid", "assignedTo", "hodUid", "facultyInchargeUid", "createdBy", "employeeId", "facultyEmployeeId", "ownerFacultyId", "incharge", "substituteFacultyId"];

async function capture() {
  const snap = await college.collection("facultyMembers").where("employeeId", "in", Array.from(new Set([employee, employee.toUpperCase(), employee.toLowerCase()]))).get();
  if (snap.size !== 1) throw new Error(`Expected exactly one faculty record for ${employee} in this college, found ${snap.size}`);
  const fdoc = snap.docs[0];
  const f = fdoc.data();
  const uid = f.userUid ?? null;
  const out = { takenAt: new Date().toISOString(), collegeId, employeeId: f.employeeId, facultyId: fdoc.id, uid, docs: {}, auth: null, related: {} };
  out.docs[`colleges/${collegeId}/facultyMembers/${fdoc.id}`] = plain(f);

  if (uid) {
    for (const p of [`colleges/${collegeId}/users/${uid}`, `systemUsers/${uid}`]) {
      const d = await db.doc(p).get();
      out.docs[p] = d.exists ? plain(d.data()) : null;
    }
    try {
      const a = await auth.getUser(uid);
      out.auth = {
        uid: a.uid, email: a.email ?? null, emailVerified: a.emailVerified, disabled: a.disabled, displayName: a.displayName ?? null,
        photoURL: a.photoURL ?? null, phoneNumber: a.phoneNumber ?? null, customClaims: a.customClaims ?? null,
        providers: a.providerData.map((p) => ({ providerId: p.providerId, uid: p.uid, email: p.email ?? null })),
        creationTime: a.metadata.creationTime, lastSignInTime: a.metadata.lastSignInTime ?? null,
        tokensValidAfterTime: a.tokensValidAfterTime ?? null, hasPassword: a.providerData.some((p) => p.providerId === "password"),
      };
    } catch (e) { out.auth = { error: e.code ?? String(e) }; }
  }
  // Employee-ID lock documents
  const h = createHash("sha256").update(String(f.employeeId).trim().toLowerCase()).digest("hex").slice(0, 40);
  for (const p of [`colleges/${collegeId}/employeeIdKeys/${h}`, `employeeIdKeys/f_${h}`]) {
    const d = await db.doc(p).get();
    out.docs[p] = d.exists ? plain(d.data()) : null;
  }
  // Everything in the college that refers to this person
  const values = [...new Set([fdoc.id, uid, f.employeeId].filter(Boolean))];
  const collections = await college.listCollections();
  out.collectionsScanned = collections.map((c) => c.id).sort();
  // Plain equality lookups, run in parallel batches (a sequential scan of every collection x field x value is far too slow).
  const jobs = [];
  for (const coll of collections) for (const field of ID_FIELDS) for (const value of values) jobs.push({ coll, field, value });
  const found = new Map(); // collection id -> Map(docId -> data)
  for (let i = 0; i < jobs.length; i += 40) {
    await Promise.all(jobs.slice(i, i + 40).map(async ({ coll, field, value }) => {
      try {
        const q = await coll.where(field, "==", value).limit(2000).get();
        for (const d of q.docs) {
          if (!found.has(coll.id)) found.set(coll.id, new Map());
          found.get(coll.id).set(d.id, plain(d.data()));
        }
      } catch { /* field not queryable in this collection - skip */ }
    }));
  }
  for (const [c, hits] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
    out.related[c] = Object.fromEntries([...hits].sort(([a], [b]) => a.localeCompare(b)));
  }
  return out;
}

const summary = (s) => {
  console.log(`Faculty ${s.employeeId} (${s.facultyId}), uid ${s.uid ?? "(none)"}`);
  console.log(`  college email on record : ${s.docs[`colleges/${s.collegeId}/facultyMembers/${s.facultyId}`]?.collegeEmail}`);
  console.log(`  users.email             : ${s.docs[`colleges/${s.collegeId}/users/${s.uid}`]?.email}`);
  console.log(`  systemUsers.email       : ${s.docs[`systemUsers/${s.uid}`]?.email}`);
  console.log(`  Firebase Auth           : ${s.auth?.email} (disabled=${s.auth?.disabled}, claims=${JSON.stringify(s.auth?.customClaims)}, password login=${s.auth?.hasPassword})`);
  console.log(`  documents captured      : ${Object.values(s.docs).filter(Boolean).length} core + ${Object.values(s.related).reduce((n, c) => n + Object.keys(c).length, 0)} related in ${Object.keys(s.related).length} collection(s)`);
  for (const [c, docs] of Object.entries(s.related)) console.log(`      ${c}: ${Object.keys(docs).length}`);
};

// ── compare ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const EXPECTED_KEYS = new Set(["collegeEmail", "email", "updatedAt", "collegeEmailHistory", "emailChangePending", "sessionsValidAfter"]);
function diff(a, b, path = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x) && !("$date" in x);
  if (isObj(a) && isObj(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap((k) => diff(a[k], b[k], path ? `${path}.${k}` : k));
  }
  return [{ path, before: a, after: b }];
}

if (compareFile) {
  const before = JSON.parse(readFileSync(compareFile, "utf8"));
  const after = await capture();
  const expected = [], unexpected = [], newDocs = [], missingDocs = [];
  const classify = (where, d) => {
    const leaf = d.path.split(".")[0];
    // Firebase keeps the email inside the password provider entry too (its uid IS the email); lastSignInTime moves if they sign in.
    const isAuthEmail = where === "Firebase Auth" && ["email", "providers", "tokensValidAfterTime", "lastSignInTime"].includes(d.path);
    (EXPECTED_KEYS.has(leaf) || isAuthEmail ? expected : unexpected).push({ where, ...d });
  };
  for (const p of new Set([...Object.keys(before.docs), ...Object.keys(after.docs)])) {
    if (before.docs[p] && !after.docs[p]) { missingDocs.push(p); continue; }
    if (!before.docs[p] && after.docs[p]) { newDocs.push(p); continue; }
    for (const d of diff(before.docs[p], after.docs[p])) classify(p, d);
  }
  for (const d of diff(before.auth, after.auth)) classify("Firebase Auth", d);
  const newRelated = [];
  for (const c of new Set([...Object.keys(before.related), ...Object.keys(after.related)])) {
    const b = before.related[c] ?? {}, a = after.related[c] ?? {};
    for (const id of Object.keys(b)) {
      if (!(id in a)) { missingDocs.push(`${c}/${id}`); continue; }
      for (const d of diff(b[id], a[id])) classify(`${c}/${id}`, d);
    }
    for (const id of Object.keys(a)) if (!(id in b)) newRelated.push(`${c}/${id}${a[id]?.action ? ` (${a[id].action})` : a[id]?.type ? ` (${a[id].type})` : ""}`);
  }
  console.log(`\nComparing ${before.employeeId} - snapshot ${before.takenAt}  vs  now ${after.takenAt}\n`);
  console.log("EXPECTED changes (the college email and its bookkeeping):");
  for (const e of expected) console.log(`   ${e.where}: ${e.path}  ${JSON.stringify(e.before)}  ->  ${JSON.stringify(e.after)}`.slice(0, 260));
  console.log(`\nNEW documents (expected: audit entry, notification): ${[...newDocs, ...newRelated].length}`);
  for (const n of [...newDocs, ...newRelated]) console.log(`   + ${n}`);
  console.log(`\nMISSING documents (anything here would be data LOSS): ${missingDocs.length}`);
  for (const m of missingDocs) console.log(`   - ${m}`);
  console.log(`\nUNEXPECTED changes (anything other than the email): ${unexpected.length}`);
  for (const u of unexpected) console.log(`   ! ${u.where}: ${u.path}  ${JSON.stringify(u.before)}  ->  ${JSON.stringify(u.after)}`.slice(0, 260));
  const ok = missingDocs.length === 0 && unexpected.length === 0;
  console.log(ok ? "\nRESULT: OK - only the college email (and its bookkeeping) changed; nothing was lost." : "\nRESULT: REVIEW NEEDED - see the lists above.");
  process.exit(ok ? 0 : 2);
}

const snapshot = await capture();
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "backups");
mkdirSync(dir, { recursive: true });
const file = join(dir, `faculty-${snapshot.employeeId}-${snapshot.takenAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(snapshot, null, 2));
console.log(`Firebase project: ${process.env.FIREBASE_ADMIN_PROJECT_ID}`);
summary(snapshot);
console.log(`\nSnapshot saved: ${file}\nNothing was written to Firestore or Auth.`);
