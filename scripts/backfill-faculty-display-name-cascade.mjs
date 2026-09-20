/**
 * One-time backfill: a faculty member's display name (Full Name as per SSC
 * preferred, Name as per PAN only as a fallback - see facultyDisplayName() in
 * src/lib/faculty/facultyDisplayName.ts) is copied into several OTHER places
 * at the moment PATCH /api/college/faculty/[id] (or /me) actually changes it -
 * colleges/{id}/users/{uid}.name, systemUsers/{uid}.name,
 * teachingAssignments.facultyName, timetableSlots.facultyName, and
 * sections.facultyInchargeName (see that route's "facultyName cascade" -
 * lines ~262-338). Those copies are never re-read afterward, so a faculty
 * record whose legalName was already correct back when this cascade was
 * added, but whose copies were last written under the OLD (PAN-preferred)
 * logic, keeps showing the PAN name in those specific places FOREVER until
 * someone opens Edit and Saves that one record - which is exactly the manual
 * step this script exists to avoid having to do for every existing faculty.
 *
 * This does NOT touch `legalName` or `name` on the facultyMembers doc itself
 * (never copies the PAN name into the SSC name, never invents a value) - it
 * only recomputes the same facultyDisplayName() precedence from whatever is
 * already stored there, and rewrites the five denormalized copies above
 * wherever they've drifted from it. A record with neither legalName nor name
 * set (so there is nothing correct to cascade) is reported and left alone.
 *
 * Idempotent - re-running it after it's been applied once finds nothing left
 * to change (every copy already matches). Only writes when a copy actually
 * differs from the correct name.
 *
 * Dry-run by default - prints exactly what it would change without writing
 * anything. Pass --apply to actually perform the backfill.
 *
 * Usage:
 *   node scripts/backfill-faculty-display-name-cascade.mjs                       (dry run, all colleges)
 *   node scripts/backfill-faculty-display-name-cascade.mjs --apply
 *   node scripts/backfill-faculty-display-name-cascade.mjs --apply --college "TEST COLLEGE"
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
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

// Same precedence as facultyDisplayName() - Full Name (as per SSC) preferred,
// Name (as per PAN) only as a fallback.
function facultyDisplayName(f) {
  return (f?.legalName ?? "").trim() || (f?.name ?? "").trim() || "";
}

// Applies `updates` to every doc in `snap` whose current value at `field`
// differs from `correctName`, batched in chunks of 400 (Firestore's per-batch
// write limit) exactly like the PATCH route's own cascade.
async function batchUpdateWhereDifferent(snap, field, correctName, now, counters, label) {
  const toUpdate = snap.docs.filter((d) => (d.data()[field] ?? "") !== correctName);
  counters.checked += snap.docs.length;
  if (toUpdate.length === 0) return;
  counters.changed += toUpdate.length;
  console.log(`    ${APPLY ? "WRITE" : "PLAN "} ${label}: ${toUpdate.length} doc(s) -> "${correctName}"`);
  if (!APPLY) return;
  for (let i = 0; i < toUpdate.length; i += 400) {
    const chunk = toUpdate.slice(i, i + 400);
    const batch = db.batch();
    for (const doc of chunk) batch.update(doc.ref, { [field]: correctName, updatedAt: now });
    await batch.commit();
  }
}

async function run() {
  const now = new Date();
  const collegesSnap = await db.collection("colleges").get();

  let facultyChecked = 0;
  let facultyWithNoName = 0;
  const loginCounters = { checked: 0, changed: 0 };
  const assignmentCounters = { checked: 0, changed: 0 };
  const slotCounters = { checked: 0, changed: 0 };
  const sectionCounters = { checked: 0, changed: 0 };

  for (const collegeDoc of collegesSnap.docs) {
    const collegeName = collegeDoc.data().name ?? "?";
    if (COLLEGE_FILTER && collegeName.trim().toLowerCase() !== COLLEGE_FILTER.trim().toLowerCase()) continue;

    const collegeRef = collegeDoc.ref;
    const facultySnap = await collegeRef.collection("facultyMembers").get();
    if (facultySnap.empty) continue;

    let collegeHeaderPrinted = false;
    const printHeader = () => {
      if (collegeHeaderPrinted) return;
      console.log(`\n=== College ${collegeDoc.id} (${collegeName}) ===`);
      collegeHeaderPrinted = true;
    };

    for (const facultyDoc of facultySnap.docs) {
      facultyChecked++;
      const f = facultyDoc.data();
      const correctName = facultyDisplayName(f);
      if (!correctName) {
        facultyWithNoName++;
        continue;
      }

      const linkedUid = f.userUid || null;

      // colleges/{id}/users/{uid}.name and systemUsers/{uid}.name
      if (linkedUid) {
        const [userSnap, systemUserSnap] = await Promise.all([
          collegeRef.collection("users").doc(linkedUid).get(),
          db.collection("systemUsers").doc(linkedUid).get(),
        ]);
        loginCounters.checked += (userSnap.exists ? 1 : 0) + (systemUserSnap.exists ? 1 : 0);
        const loginUpdate = {};
        if (userSnap.exists && (userSnap.data().name ?? "") !== correctName) loginUpdate.usersDoc = true;
        if (systemUserSnap.exists && (systemUserSnap.data().name ?? "") !== correctName) loginUpdate.systemUsersDoc = true;
        if (loginUpdate.usersDoc || loginUpdate.systemUsersDoc) {
          printHeader();
          console.log(
            `  ${f.employeeId ?? facultyDoc.id}: login name "${loginUpdate.usersDoc ? userSnap.data().name : systemUserSnap.data().name}" -> "${correctName}"`
          );
          loginCounters.changed += (loginUpdate.usersDoc ? 1 : 0) + (loginUpdate.systemUsersDoc ? 1 : 0);
          if (APPLY) {
            if (loginUpdate.usersDoc) await collegeRef.collection("users").doc(linkedUid).set({ name: correctName, updatedAt: now }, { merge: true });
            if (loginUpdate.systemUsersDoc) await db.collection("systemUsers").doc(linkedUid).set({ name: correctName, updatedAt: now }, { merge: true });
          }
        }
      }

      // teachingAssignments.facultyName / timetableSlots.facultyName
      const [assignmentsSnap, slotsSnap] = await Promise.all([
        collegeRef.collection("teachingAssignments").where("facultyId", "==", facultyDoc.id).get(),
        collegeRef.collection("timetableSlots").where("facultyId", "==", facultyDoc.id).get(),
      ]);
      if (assignmentsSnap.docs.some((d) => (d.data().facultyName ?? "") !== correctName)) printHeader();
      await batchUpdateWhereDifferent(assignmentsSnap, "facultyName", correctName, now, assignmentCounters, `${f.employeeId ?? facultyDoc.id} teachingAssignments.facultyName`);
      await batchUpdateWhereDifferent(slotsSnap, "facultyName", correctName, now, slotCounters, `${f.employeeId ?? facultyDoc.id} timetableSlots.facultyName`);

      // sections.facultyInchargeName - facultyInchargeUid matches either the
      // linked login uid or (on some older records) the FacultyMember doc id
      // itself, same two candidates the PATCH route checks.
      const inchargeCandidates = linkedUid && linkedUid !== facultyDoc.id ? [linkedUid, facultyDoc.id] : [facultyDoc.id];
      const sectionsSnap = await collegeRef.collection("sections").where("facultyInchargeUid", "in", inchargeCandidates).get();
      if (sectionsSnap.docs.some((d) => (d.data().facultyInchargeName ?? "") !== correctName)) printHeader();
      await batchUpdateWhereDifferent(sectionsSnap, "facultyInchargeName", correctName, now, sectionCounters, `${f.employeeId ?? facultyDoc.id} sections.facultyInchargeName`);
    }
  }

  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN (pass --apply to write)"}`);
  console.log(`  faculty records checked: ${facultyChecked} (${facultyWithNoName} with no legalName/name at all - skipped)`);
  console.log(`  login docs (users/systemUsers) checked: ${loginCounters.checked}, corrected: ${loginCounters.changed}`);
  console.log(`  teachingAssignments checked: ${assignmentCounters.checked}, corrected: ${assignmentCounters.changed}`);
  console.log(`  timetableSlots checked: ${slotCounters.checked}, corrected: ${slotCounters.changed}`);
  console.log(`  sections checked: ${sectionCounters.checked}, corrected: ${sectionCounters.changed}`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
