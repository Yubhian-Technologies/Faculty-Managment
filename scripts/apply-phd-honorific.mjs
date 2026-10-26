/**
 * Gives every faculty member whose Highest Qualification is Ph.D the honorific "Dr." - the same rule the save routes now apply
 * to new data (src/lib/faculty/phdHonorific.ts). DRY RUN BY DEFAULT: nothing is written unless --apply is given.
 *
 *   node scripts/apply-phd-honorific.mjs --colleges=<id>,<id>                 -> report only
 *   node scripts/apply-phd-honorific.mjs --colleges=<id>,<id> --apply         -> write (a revert log is saved FIRST)
 *   node scripts/apply-phd-honorific.mjs --revert=backups/phd-honorific-<time>.json   -> put every change back
 *
 * What it will and will not do:
 *  - only FILLS a blank / missing honorific. An honorific somebody chose ("Mr.", "Prof." ...) is never replaced - those
 *    faculty are listed as "conflicts" for a person to decide;
 *  - uses each college's OWN catalog spelling of Dr ("Dr." or "Dr"); a college whose honorific list has no Dr entry is skipped;
 *  - writes ONE field on the faculty record (honorific) and nothing else - no other value, not even updatedAt;
 *  - then updates the display name where the app itself copies it (what PATCH /api/college/faculty/[id] does for an honorific
 *    change): the linked login (users + systemUsers, only if that document already exists), teachingAssignments.facultyName,
 *    timetableSlots.facultyName and sections.facultyInchargeName. Historical records (attendance, marks ...) are left alone;
 *  - is repeatable: a second run finds nothing left to do.
 * Writes the change log to backups/ (git-ignored) before the first write; --revert uses it.
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { normalizeHighestQualification } from "../src/lib/faculty/highestQualification.ts";
import { facultyDisplayName } from "../src/lib/faculty/facultyDisplayName.ts";
import { catalogDrName, honorificForPhd, isBlankHonorific } from "../src/lib/faculty/phdHonorific.ts";

const CHUNK = 400;

export async function activeHonorificNames(db, collegeId) {
  const snap = await db.collection("colleges").doc(collegeId).collection("honorifics").where("isActive", "==", true).get();
  return snap.docs.map((d) => d.data().name).filter((n) => typeof n === "string" && n.trim());
}

/** What would change in one college. Reads only. */
export async function planPhdHonorific(db, collegeId) {
  const catalog = await activeHonorificNames(db, collegeId);
  const dr = catalogDrName(catalog);
  const plan = { collegeId, catalog, dr, phd: 0, willSet: [], alreadyHave: 0, conflicts: [], skippedNoName: [], skippedNoCatalogDr: 0 };
  const snap = await db.collection("colleges").doc(collegeId).collection("facultyMembers").get();
  for (const doc of snap.docs) {
    const d = doc.data();
    if (normalizeHighestQualification(d.highestQualification) !== "Ph.D") continue;
    plan.phd++;
    const row = { id: doc.id, employeeId: d.employeeId ?? "", legalName: d.legalName ?? "", status: d.status ?? "", honorific: d.honorific };
    if (!isBlankHonorific(d.honorific)) {
      // already has one: "Dr"/"Dr." need nothing; any other is a person's choice and is only reported
      if (catalogDrName([String(d.honorific)]) !== null) plan.alreadyHave++;
      else plan.conflicts.push(row);
      continue;
    }
    const target = honorificForPhd({ isPhd: true, honorific: d.honorific }, catalog);
    if (!target) { plan.skippedNoCatalogDr++; continue; }
    if (!String(d.legalName ?? "").trim()) { plan.skippedNoName.push(row); continue; }
    plan.willSet.push({ ...row, target, userUid: d.userUid ?? null });
  }
  return plan;
}

async function updateIfExists(ref, data) {
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.update(data);
  return true;
}

async function renameInChunks(db, docs, field, name) {
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + CHUNK)) batch.update(d.ref, { [field]: name });
    await batch.commit();
  }
  return docs.length;
}

/**
 * Sets (or, with `null`, removes) the honorific on ONE faculty record and carries the new display name to the places the app
 * copies it. Used for both applying and reverting, so the two can never disagree about what they touch.
 */
export async function setFacultyHonorific(db, collegeId, facultyId, honorific) {
  const ref = db.collection("colleges").doc(collegeId).collection("facultyMembers").doc(facultyId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: "faculty record not found" };
  const before = snap.data();
  const oldName = facultyDisplayName(before);
  const newName = facultyDisplayName({ legalName: before.legalName, honorific: honorific ?? "" });

  // the ONLY field written on the faculty record
  await ref.update({ honorific: honorific === null ? FieldValue.delete() : honorific });

  const out = { ok: true, oldName, newName, login: false, systemLogin: false, assignments: 0, slots: 0, sections: 0 };
  if (newName === oldName) return out;

  const uid = typeof before.userUid === "string" && before.userUid ? before.userUid : null;
  const college = db.collection("colleges").doc(collegeId);
  if (uid) {
    out.login = await updateIfExists(college.collection("users").doc(uid), { name: newName });
    out.systemLogin = await updateIfExists(db.collection("systemUsers").doc(uid), { name: newName });
  }
  const [assignments, slots] = await Promise.all([
    college.collection("teachingAssignments").where("facultyId", "==", facultyId).get(),
    college.collection("timetableSlots").where("facultyId", "==", facultyId).get(),
  ]);
  out.assignments = await renameInChunks(db, assignments.docs, "facultyName", newName);
  out.slots = await renameInChunks(db, slots.docs, "facultyName", newName);
  // Section.facultyInchargeUid holds the login uid, or on older records the faculty doc id itself
  const candidates = uid && uid !== facultyId ? [uid, facultyId] : [facultyId];
  const sections = await college.collection("sections").where("facultyInchargeUid", "in", candidates).get();
  out.sections = await renameInChunks(db, sections.docs, "facultyInchargeName", newName);
  return out;
}

/** Applies a plan. The log (what each record held BEFORE) is handed to `saveLog` before the first write. */
export async function applyPlans(db, plans, saveLog) {
  const changes = plans.flatMap((p) => p.willSet.map((r) => ({
    collegeId: p.collegeId, facultyId: r.id, employeeId: r.employeeId, legalName: r.legalName,
    before: { honorific: r.honorific === undefined ? null : r.honorific, present: r.honorific !== undefined }, after: { honorific: r.target },
  })));
  saveLog({ takenAt: new Date().toISOString(), changes });
  const results = [];
  for (const c of changes) {
    try {
      results.push({ ...c, result: await setFacultyHonorific(db, c.collegeId, c.facultyId, c.after.honorific) });
    } catch (err) {
      results.push({ ...c, result: { ok: false, reason: err instanceof Error ? err.message : String(err) } });
    }
  }
  return results;
}

/** Puts every change in a log back: the previous honorific (or no honorific at all) and the previous display names. */
export async function revertLog(db, log) {
  const results = [];
  for (const c of log.changes) {
    try {
      const previous = c.before.present ? c.before.honorific : null;
      results.push({ ...c, result: await setFacultyHonorific(db, c.collegeId, c.facultyId, previous) });
    } catch (err) {
      results.push({ ...c, result: { ok: false, reason: err instanceof Error ? err.message : String(err) } });
    }
  }
  return results;
}

function connect() {
  if (getApps().length) return getFirestore();
  if (process.env.FIRESTORE_EMULATOR_HOST) initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-phd-honorific" });
  else {
    initializeApp({ credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n"),
    }) });
  }
  return getFirestore();
}

function report(plan) {
  console.log(`\ncollege ${plan.collegeId}: honorific list = [${plan.catalog.join(", ")}]  ->  "Dr" entry: ${plan.dr === null ? "NONE (college skipped)" : JSON.stringify(plan.dr)}`);
  console.log(`  Ph.D faculty: ${plan.phd} | already Dr: ${plan.alreadyHave} | will be set to ${JSON.stringify(plan.dr)}: ${plan.willSet.length} | other honorific chosen (left alone): ${plan.conflicts.length} | no name: ${plan.skippedNoName.length} | skipped, no Dr in list: ${plan.skippedNoCatalogDr}`);
  const byStatus = {};
  for (const r of plan.willSet) byStatus[r.status || "(none)"] = (byStatus[r.status || "(none)"] ?? 0) + 1;
  if (plan.willSet.length) console.log(`  will be set, by status: ${JSON.stringify(byStatus)}`);
  for (const r of plan.conflicts) console.log(`  LEFT ALONE  ${r.employeeId}  ${r.legalName}  honorific=${JSON.stringify(r.honorific)}  (Ph.D, but a different honorific was chosen)`);
  for (const r of plan.skippedNoName) console.log(`  SKIPPED  ${r.employeeId}  no Full Name to prefix`);
}

async function main() {
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const apply = process.argv.includes("--apply");
  const revert = arg("revert");
  const db = connect();
  const here = dirname(fileURLToPath(import.meta.url));

  if (revert) {
    const log = JSON.parse(readFileSync(revert, "utf8"));
    const results = await revertLog(db, log);
    const bad = results.filter((r) => !r.result.ok);
    console.log(`reverted ${results.length - bad.length} of ${results.length}`);
    for (const r of bad) console.log("  FAILED", r.employeeId, r.result.reason);
    process.exit(bad.length ? 1 : 0);
  }

  const colleges = (arg("colleges") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!colleges.length) { console.error("usage: --colleges=<id>,<id> [--apply]  |  --revert=<log.json>"); process.exit(1); }
  const plans = [];
  for (const c of colleges) { const p = await planPhdHonorific(db, c); plans.push(p); report(p); }
  const total = plans.reduce((n, p) => n + p.willSet.length, 0);
  if (!apply) { console.log(`\nDRY RUN - nothing written. ${total} faculty would be set. Add --apply to write.`); return; }
  if (!total) { console.log("\nnothing to do."); return; }

  const dir = join(here, "..", "backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `phd-honorific-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const results = await applyPlans(db, plans, (log) => { writeFileSync(file, JSON.stringify(log, null, 2)); console.log(`\nrevert log saved: ${file}`); });
  const bad = results.filter((r) => !r.result.ok);
  const sum = (k) => results.reduce((n, r) => n + (r.result[k] || 0), 0);
  console.log(`set ${results.length - bad.length} of ${results.length} | logins updated: ${results.filter((r) => r.result.login).length} | teaching assignments: ${sum("assignments")} | timetable slots: ${sum("slots")} | sections: ${sum("sections")}`);
  for (const r of bad) console.log("  FAILED", r.employeeId, r.result.reason);

  // verify: re-read every record that was meant to change
  let wrong = 0;
  for (const r of results.filter((x) => x.result.ok)) {
    const d = (await db.collection("colleges").doc(r.collegeId).collection("facultyMembers").doc(r.facultyId).get()).data();
    if (d?.honorific !== r.after.honorific) { wrong++; console.log("  VERIFY FAILED", r.employeeId); }
  }
  console.log(wrong ? `VERIFY: ${wrong} records do not hold the new honorific` : "VERIFY OK: every changed record holds its new honorific");
  process.exit(bad.length || wrong ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
