/**
 * One-time repair: for a period during development, some pages that create
 * teachingAssignments/timetableSlots docs were writing the faculty member's
 * Firebase Auth uid into `facultyId` instead of their `facultyMembers` doc
 * id. Every reader of these collections (GET /api/college/teaching-
 * assignments via resolveFacultyMemberId, the Internal Marks module, the
 * Exam Cell's Internal Exam marks entry) expects `facultyId` to be the
 * facultyMembers doc id, so those bad records were invisible to the faculty
 * member's own "my assignments" views.
 *
 * This scans every college's teachingAssignments/timetableSlots for a
 * facultyId that is actually a valid users/{uid} AND has a facultyMembers
 * record linked to it via userUid (the bug's signature), and repoints it to
 * that facultyMembers doc id. A record already holding a facultyMembers doc
 * id is left untouched.
 *
 * Usage:
 *   node scripts/fix-teaching-assignment-faculty-ids.mjs           # dry run
 *   node scripts/fix-teaching-assignment-faculty-ids.mjs --apply   # write the fix
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const apply = process.argv.includes("--apply");

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

async function run() {
  const collegesSnap = await db.collection("colleges").get();
  let totalFixed = 0;

  for (const collegeDoc of collegesSnap.docs) {
    const collegeRef = collegeDoc.ref;
    const [facultySnap, usersSnap, assignmentsSnap, slotsSnap] = await Promise.all([
      collegeRef.collection("facultyMembers").get(),
      collegeRef.collection("users").get(),
      collegeRef.collection("teachingAssignments").get(),
      collegeRef.collection("timetableSlots").get(),
    ]);

    // login uid -> facultyMembers doc id, only for members with a linked login.
    const uidToFacultyDocId = new Map();
    for (const f of facultySnap.docs) {
      const userUid = f.data().userUid;
      if (userUid) uidToFacultyDocId.set(userUid, f.id);
    }
    const validUids = new Set(usersSnap.docs.map((d) => d.id));
    const facultyDocIds = new Set(facultySnap.docs.map((d) => d.id));

    const fixes = [];
    for (const [label, snap] of [["teachingAssignment", assignmentsSnap], ["timetableSlot", slotsSnap]]) {
      for (const doc of snap.docs) {
        const current = doc.data().facultyId;
        if (!current || facultyDocIds.has(current)) continue; // already correct (or unset)
        if (!validUids.has(current)) continue; // not a uid either - unrelated/unknown shape, leave untouched
        const realFacultyDocId = uidToFacultyDocId.get(current);
        if (!realFacultyDocId) continue; // uid has no linked facultyMembers record - not this bug
        fixes.push({ ref: doc.ref, kind: label, id: doc.id, label2: doc.data().subjectName ?? "?", from: current, to: realFacultyDocId });
      }
    }

    if (fixes.length === 0) continue;

    console.log(`College ${collegeDoc.id} (${collegeDoc.data().name ?? "?"}):`);
    for (const f of fixes) {
      console.log(`  - ${f.kind} ${f.id} (${f.label2}) facultyId: ${f.from} -> ${f.to}`);
    }
    totalFixed += fixes.length;

    if (apply) {
      for (let i = 0; i < fixes.length; i += 400) {
        const batch = db.batch();
        for (const f of fixes.slice(i, i + 400)) {
          batch.update(f.ref, { facultyId: f.to });
        }
        await batch.commit();
      }
      console.log(`  ✓ fixed`);
    }
  }

  if (totalFixed === 0) {
    console.log("No affected records found.");
  } else if (!apply) {
    console.log(`\n${totalFixed} record(s) found across all colleges. Re-run with --apply to fix them.`);
  } else {
    console.log(`\n✓ Fixed ${totalFixed} record(s).`);
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
