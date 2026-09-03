/**
 * Read-only diagnostic for reverting a set of department renames.
 *
 * The user renamed several `colleges/{id}/departments` docs (in place, via
 * the PATCH /api/college/departments admin UI) to new display names, but the
 * rename never cascades into the many collections that store a copy of the
 * department name as free text (users.department/departments[],
 * sections.department/secondaryDepartments, students.department, etc — see
 * scripts/fix-stale-department-name-refs.mjs for the full list). All of
 * those still say the OLD name. The plan is to revert `departments.name`
 * back to the old name for each of these four departments, which would
 * reconnect everything in one write per department PROVIDED nothing new was
 * created under the new name since the rename.
 *
 * This script does not write anything. For each old/new name pair it:
 *   1. Finds the department doc currently holding the NEW name (per college).
 *   2. Confirms no department doc already holds the OLD name (which would
 *      make a plain revert collide / need a different plan).
 *   3. Counts, across every collection known to store a `department` name
 *      string, how many docs reference the OLD name vs the NEW name - so we
 *      know whether a plain name revert is safe (nothing referencing NEW) or
 *      whether some records were already created post-rename under the NEW
 *      name (which a plain revert would then orphan).
 *
 * Usage:
 *   node scripts/diagnose-department-rename-revert.mjs
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

// new name -> old name
const RENAME_MAP = {
  "COMPUTER SCIENCE & ENGINEERING": "COMPUTER SCIENCE AND ENGINEERING",
  "COMPUTER SCIENCE AND BUSINESS SYSTEM": "Computer Science and Business Systems",
  "COMPUTER SCIENCE AND ENGINEERING (ARTIFICIAL INTELLIGENCE AND DATA SCIENCE)": "ARTIFICIAL INTELLIGENCE AND DATA SCIENCE",
  "COMPUTER SCIENCE AND ENGINEERING (ARTIFICIAL INTELLIGENCE AND MACHINE LEARNING)": "ARTIFICIAL INTELLIGENCE AND MACHINE LEARNING",
};

// Collections known (from src/types/*.ts + firestore.indexes.json) to store
// a department name as a plain string field, plus the field name(s) to check.
const DEPT_STRING_COLLECTIONS = [
  ["users", ["department"]],
  ["sections", ["department"]],
  ["students", ["department", "secondaryDepartment"]],
  ["facultyMembers", ["department"]],
  ["attendanceRecords", ["department"]],
  ["teachingAssignments", ["department"]],
  ["permissionRequests", ["department"]],
  ["onDutyRequests", ["department"]],
  ["leaveRequests", ["department"]],
  ["salaryRecords", ["department"]],
  ["appraisals", ["department"]],
];

const norm = (s) => (s ?? "").trim();

async function countByField(collRef, field, value) {
  if (!value) return 0;
  try {
    const snap = await collRef.where(field, "==", value).count().get();
    return snap.data().count;
  } catch {
    const snap = await collRef.where(field, "==", value).get();
    return snap.size;
  }
}

async function run() {
  const collegesSnap = await db.collection("colleges").get();

  for (const college of collegesSnap.docs) {
    const collegeRef = college.ref;
    const deptsSnap = await collegeRef.collection("departments").get();
    if (deptsSnap.empty) continue;

    const byName = new Map();
    for (const d of deptsSnap.docs) {
      const name = norm(d.data().name);
      if (name) byName.set(name, d);
    }

    let printedCollegeHeader = false;
    const printCollegeHeader = () => {
      if (printedCollegeHeader) return;
      console.log(`\n\n########## College ${college.id} (${college.data().name ?? "?"}) ##########`);
      printedCollegeHeader = true;
    };

    for (const [newName, oldName] of Object.entries(RENAME_MAP)) {
      const newDoc = byName.get(newName);
      const oldDoc = byName.get(oldName);
      if (!newDoc && !oldDoc) continue; // this college doesn't have this department at all

      printCollegeHeader();
      console.log(`\n--- "${oldName}"  <->  "${newName}" ---`);
      console.log(`  department doc with NEW name: ${newDoc ? `id=${newDoc.id}` : "NOT FOUND"}`);
      console.log(`  department doc with OLD name: ${oldDoc ? `id=${oldDoc.id} (COLLISION - a doc already has the old name)` : "none (safe to revert)"}`);

      for (const [collName, fields] of DEPT_STRING_COLLECTIONS) {
        const collRef = collegeRef.collection(collName);
        for (const field of fields) {
          const [oldCount, newCount] = await Promise.all([
            countByField(collRef, field, oldName),
            countByField(collRef, field, newName),
          ]);
          if (oldCount > 0 || newCount > 0) {
            console.log(`    ${collName}.${field}: old="${oldName}" -> ${oldCount} doc(s) | new="${newName}" -> ${newCount} doc(s)`);
          }
        }
      }

      // secondaryDepartments/managedDepartments arrays on other department docs
      for (const d of deptsSnap.docs) {
        const dept = d.data();
        for (const field of ["secondaryDepartments", "managedDepartments"]) {
          const arr = dept[field] ?? [];
          if (arr.includes(oldName) || arr.includes(newName)) {
            console.log(`    departments/${d.id} (${dept.name}).${field}: [${arr.join(", ")}]`);
          }
        }
        const courseScopes = dept.courseScopes ?? {};
        for (const [catalogId, scope] of Object.entries(courseScopes)) {
          const arr = scope.secondaryDepartments ?? [];
          if (arr.includes(oldName) || arr.includes(newName)) {
            console.log(`    departments/${d.id} (${dept.name}).courseScopes[${catalogId}].secondaryDepartments: [${arr.join(", ")}]`);
          }
        }
      }

      // users.departments[] array field (in addition to the scalar users.department checked above)
      const usersSnap = await collegeRef.collection("users").get();
      for (const u of usersSnap.docs) {
        const arr = u.data().departments ?? [];
        if (Array.isArray(arr) && (arr.includes(oldName) || arr.includes(newName))) {
          console.log(`    users/${u.id} (${u.data().name ?? u.data().email ?? "?"}).departments: [${arr.join(", ")}]`);
        }
      }
    }
  }

  console.log("\n\nDone. This was a read-only diagnostic - nothing was written.");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
