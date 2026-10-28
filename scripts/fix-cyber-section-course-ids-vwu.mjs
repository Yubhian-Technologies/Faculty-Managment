/**
 * One-time fix for VISHNU WOMEN'S UNIVERSITY (c3a1195c049c44ca9945):
 * the Years 2-4 sections of "CSE [CYBER SECURITY]" are filed under BASIC SCIENCE - ENGLISH's
 * B.Tech course (JSfc92...), while the department's subject assignments use its parent CSE's
 * course (yRTnYi...). Teaching Assignments looks sections and subjects up by one course id,
 * so it finds one or the other. Re-points the sections (and any row that copies their
 * courseId) at CSE's course. Year 1 is left alone (shared first year).
 *
 * Only courseId / courseName change; no doc is re-keyed. DRY RUN by default;
 * --apply writes after saving a JSON backup (backups/).
 *
 *   node scripts/fix-cyber-section-course-ids-vwu.mjs
 *   node scripts/fix-cyber-section-course-ids-vwu.mjs --apply
 */
import { init, parseArgs, writeBackup, banner } from "./lib/scriptKit.mjs";

const { apply } = parseArgs();
const { db } = init();
banner(apply);

const COLLEGE_ID = "c3a1195c049c44ca9945";
const OLD_COURSE = "JSfc92NxQ9CVpPcvpl89";
const NEW_COURSE = "yRTnYiye6GiQVLOrKet0";
const SECTION_IDS = ["nTg0QHRZY1iBvEprk1Wd", "h70WbDr2OWDeI09oc5X0", "0sAFQ64m5mapzlqt1OCR"]; // years 2, 3, 4
const REFERRERS = ["students", "teachingAssignments", "timetableSlots"];

const C = db.collection("colleges").doc(COLLEGE_ID);
const newCourse = (await C.collection("courses").doc(NEW_COURSE).get()).data();
if (!newCourse) { console.error("Target course not found"); process.exit(1); }

const writes = []; // { ref, before, patch }
for (const id of SECTION_IDS) {
  const snap = await C.collection("sections").doc(id).get();
  if (!snap.exists) { console.error(`Section ${id} not found - skipping`); continue; }
  const s = snap.data();
  if (s.courseId === NEW_COURSE) continue; // already fixed
  if (s.courseId !== OLD_COURSE) { console.error(`Section ${id} has unexpected courseId ${s.courseId} - skipping`); continue; }
  console.log(`section ${s.name} year ${s.year}: ${s.courseName ?? "?"} -> ${newCourse.name}`);
  writes.push({ ref: snap.ref, before: { courseId: s.courseId, courseName: s.courseName ?? null }, patch: { courseId: NEW_COURSE, courseName: newCourse.name } });
}

for (const coll of REFERRERS) {
  const snap = await C.collection(coll).where("sectionId", "in", SECTION_IDS).get();
  const stale = snap.docs.filter((d) => d.data().courseId === OLD_COURSE);
  console.log(`${coll}: ${snap.size} row(s) on these sections, ${stale.length} carry the old courseId`);
  for (const d of stale) {
    const x = d.data();
    const patch = { courseId: NEW_COURSE };
    if ("courseName" in x) patch.courseName = newCourse.name;
    writes.push({ ref: d.ref, before: { courseId: x.courseId, courseName: x.courseName ?? null }, patch });
  }
}

console.log(`${writes.length} doc(s) to write`);
if (!apply || writes.length === 0) { console.log(apply ? "Nothing to do." : "Dry run - pass --apply to write."); process.exit(0); }

console.log(`backup: ${writeBackup(`cyber-section-courseid-${COLLEGE_ID}`, writes.map((w) => ({ path: w.ref.path, before: w.before })))}`);
for (let i = 0; i < writes.length; i += 400) {
  const batch = db.batch();
  for (const w of writes.slice(i, i + 400)) batch.update(w.ref, w.patch);
  await batch.commit();
}
console.log("done.");
