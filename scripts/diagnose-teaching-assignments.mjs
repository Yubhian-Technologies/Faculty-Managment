/**
 * Read-only diagnostic: for every college, list facultyMembers (with their
 * linked login uid, if any) and teachingAssignments (with the facultyId they
 * point at), and flag any assignment whose facultyId doesn't resolve to a
 * real users/{uid} doc — the same signature the uid-link bug had.
 *
 * Usage: node scripts/diagnose-teaching-assignments.mjs
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

  for (const collegeDoc of collegesSnap.docs) {
    const collegeRef = collegeDoc.ref;
    const [facultySnap, usersSnap, assignmentsSnap] = await Promise.all([
      collegeRef.collection("facultyMembers").get(),
      collegeRef.collection("users").get(),
      collegeRef.collection("teachingAssignments").get(),
    ]);

    if (facultySnap.empty && assignmentsSnap.empty) continue;

    console.log(`\n=== College ${collegeDoc.id} (${collegeDoc.data().name ?? "?"}) ===`);

    const validUids = new Set(usersSnap.docs.map((d) => d.id));
    const usersById = new Map(usersSnap.docs.map((d) => [d.id, d.data()]));

    console.log(`-- facultyMembers (${facultySnap.size}) --`);
    for (const f of facultySnap.docs) {
      const d = f.data();
      const linked = d.userUid ? (validUids.has(d.userUid) ? "OK" : "userUid set but NOT a valid users/{uid} doc!") : "NO LOGIN LINKED";
      console.log(`  ${f.id}  name=${d.name}  role=${d.role ?? "?"}  userUid=${d.userUid ?? "-"}  [${linked}]`);
    }

    console.log(`-- teachingAssignments (${assignmentsSnap.size}) --`);
    if (assignmentsSnap.empty) console.log("  (none)");
    for (const a of assignmentsSnap.docs) {
      const d = a.data();
      const facultyIdOk = validUids.has(d.facultyId) ? "OK (matches a real user uid)" : "BROKEN (facultyId does not match any users/{uid} doc)";
      console.log(
        `  ${a.id}  subject=${d.subjectName ?? "?"} (${d.subjectId})  facultyId=${d.facultyId}  facultyName=${d.facultyName}  isPast=${!!d.isPast}  [${facultyIdOk}]`
      );
      if (validUids.has(d.facultyId)) {
        const u = usersById.get(d.facultyId);
        console.log(`      -> resolves to user: email=${u?.email} role=${u?.role}`);
      }
    }
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
