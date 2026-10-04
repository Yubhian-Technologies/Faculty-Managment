/**
 * Stamps `facultyIds` on every timetableDrafts document that lacks a correct
 * one, then marks the college's draft index as ready.
 *
 * WHY: the Timetable editor used to read EVERY draft in the college on every
 * edit just to learn which faculty were already placed elsewhere. Drafts keep
 * their slots in an array, which Firestore cannot query by faculty, so the
 * editor now reads only the drafts whose `facultyIds` include the faculty it
 * cares about (lib/timetable/loadContext.ts). That is only safe once EVERY
 * draft carries the field - so the editor keeps reading every draft, exactly as
 * before, until this script has run and written the marker document
 *   colleges/{id}/settings/timetableDraftFacultyIndex  { ready: true }
 *
 * SAFE BY DEFAULT:
 *   - DRY RUN unless --apply is given: nothing is written to Firestore.
 *   - A JSON backup of every affected document (full data) is written to
 *     backups/ BEFORE any write, in both modes (dry runs get a `-dryrun` file).
 *   - Only the `facultyIds` field is touched, and the marker document. No
 *     document or field is deleted.
 *   - Idempotent: re-running finds nothing left to change.
 *   - After writing, it re-reads and verifies every draft; the marker is only
 *     written if every draft in the college verified clean.
 *
 * DEPLOY ORDER: ship the code that maintains `facultyIds` (draft route POST/
 * PATCH) FIRST. If this runs before it, a draft edited afterwards would be
 * un-indexed again while the marker says ready.
 *
 * Reads Admin SDK credentials from .env (FIREBASE_ADMIN_*) - the project id is
 * printed first so you can confirm which environment you are pointing at.
 *
 * Usage:
 *   node scripts/backfill-timetable-draft-faculty-ids.mjs                 # dry run, every college
 *   node scripts/backfill-timetable-draft-faculty-ids.mjs --college <id>  # dry run, one college
 *   node scripts/backfill-timetable-draft-faculty-ids.mjs --apply [--college <id>]
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { facultyIdsOf, planDraftFacultyIds } from "./lib/draftFacultyIds.mjs";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const collegeFlag = args.indexOf("--college");
const onlyCollege = collegeFlag >= 0 ? args[collegeFlag + 1] : undefined;
const CHUNK = 400;

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}
const db = getFirestore();

console.log(`${APPLY ? "APPLY" : "DRY RUN"} - project: ${process.env.FIREBASE_ADMIN_PROJECT_ID}`);
if (!APPLY) console.log("(nothing will be written to Firestore; pass --apply to write)\n");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync("backups", { recursive: true });

const collegeDocs = onlyCollege
  ? [await db.collection("colleges").doc(onlyCollege).get()]
  : (await db.collection("colleges").get()).docs;

let totalToChange = 0;
for (const college of collegeDocs) {
  if (!college.exists) { console.log(`college ${college.id}: not found`); continue; }
  const draftsCol = db.collection("colleges").doc(college.id).collection("timetableDrafts");
  const snap = await draftsCol.get();
  const drafts = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  const { updates, alreadyCorrect } = planDraftFacultyIds(drafts);
  totalToChange += updates.length;
  console.log(`college ${college.id} (${college.data()?.name ?? "?"}): ${drafts.length} drafts, ${alreadyCorrect} already correct, ${updates.length} to stamp`);
  if (updates.length === 0 && !APPLY) continue;

  // Backup first - the full current data of every document about to change.
  const affected = new Set(updates.map((u) => u.id));
  const backup = drafts.filter((d) => affected.has(d.id)).map((d) => ({ path: `colleges/${college.id}/timetableDrafts/${d.id}`, data: d.data }));
  const file = `backups/timetable-draft-faculty-ids-${college.id}-${stamp}${APPLY ? "" : "-dryrun"}.json`;
  writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`  backup of ${backup.length} document(s) -> ${file}`);
  if (!APPLY) continue;

  for (let i = 0; i < updates.length; i += CHUNK) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + CHUNK)) batch.update(draftsCol.doc(u.id), { facultyIds: u.facultyIds });
    await batch.commit();
  }

  // Verify every draft in the college (not just the ones touched) before declaring the index ready.
  const verify = (await draftsCol.get()).docs.map((d) => ({ id: d.id, data: d.data() }));
  const leftover = planDraftFacultyIds(verify).updates;
  if (leftover.length > 0) {
    console.error(`  VERIFY FAILED: ${leftover.length} draft(s) still wrong (e.g. ${leftover[0].id}) - marker NOT written`);
    process.exitCode = 1;
    continue;
  }
  await db.collection("colleges").doc(college.id).collection("settings").doc("timetableDraftFacultyIndex")
    .set({ ready: true, stampedAt: new Date(), draftsVerified: verify.length });
  console.log(`  verified ${verify.length} draft(s); marker written (index ready)`);
}

console.log(APPLY ? "\nDone." : `\nDry run complete: ${totalToChange} draft(s) would be stamped. Re-run with --apply to write.`);
// facultyIdsOf is re-exported only so a quick `node -e` check can import it from here.
export { facultyIdsOf };
