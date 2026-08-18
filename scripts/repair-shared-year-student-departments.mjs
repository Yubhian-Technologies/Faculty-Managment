/**
 * One-time repair: restores `department`/`secondaryDepartment` for students
 * whose department was prematurely flipped to their real branch at
 * section-assignment time (the bug fixed in students/[id] PATCH,
 * students/distribute, students/distribute-cohort) instead of being left
 * alone until promotion.
 *
 * For each student still in the same year they were created in (never
 * legitimately promoted since - so we're never undoing a real transition),
 * if their FIRST departmentHistory entry names a shared/common department
 * (a parent department with hasSubDepartments, or one of its sub-departments)
 * and their CURRENT department differs from it, restores:
 *   department = <that first history entry's department>
 *   secondaryDepartment = <the student's current, about-to-be-overwritten department>
 * and appends a departmentHistory entry recording the repair.
 *
 * Dry-run by default - prints a report and writes nothing. Pass --apply to write.
 *
 * Usage:
 *   node scripts/repair-shared-year-student-departments.mjs
 *   node scripts/repair-shared-year-student-departments.mjs --apply
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
const APPLY = process.argv.includes("--apply");

async function run() {
  const collegesSnap = await db.collection("colleges").get();
  let totalCandidates = 0;
  let totalRepaired = 0;

  for (const collegeDoc of collegesSnap.docs) {
    const collegeRef = collegeDoc.ref;
    const deptsSnap = await collegeRef.collection("departments").get();
    const depts = deptsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const sharedDeptNames = new Set();
    for (const d of depts) {
      if (d.hasSubDepartments && !d.parentDepartmentId) {
        sharedDeptNames.add(d.name);
        for (const child of depts.filter((c) => c.parentDepartmentId === d.id)) {
          sharedDeptNames.add(child.name);
        }
      }
    }
    if (sharedDeptNames.size === 0) continue; // no shared-year structure here - nothing to repair

    const studentsSnap = await collegeRef.collection("students").get();
    if (studentsSnap.empty) continue;

    const candidates = [];

    for (const studentDoc of studentsSnap.docs) {
      const student = studentDoc.data();
      const historySnap = await studentDoc.ref
        .collection("departmentHistory")
        .orderBy("from", "asc")
        .limit(1)
        .get();
      if (historySnap.empty) continue;

      const first = historySnap.docs[0].data();
      const firstDept = (first.department ?? "").trim();
      const currentDept = (student.department ?? "").trim();

      if (!sharedDeptNames.has(firstDept)) continue;
      if (currentDept === firstDept) continue;
      if (Number(student.year) !== Number(first.year)) continue; // promoted since - leave alone

      candidates.push({
        id: studentDoc.id,
        name: student.name ?? "(no name)",
        rollNumber: student.rollNumber ?? "",
        year: student.year,
        section: student.section ?? "",
        currentDepartment: currentDept,
        restoreDepartment: firstDept,
        newSecondaryDepartment: currentDept,
      });
    }

    if (candidates.length === 0) continue;

    console.log(`\n=== College ${collegeDoc.id} (${collegeDoc.data().name ?? "?"}) ===`);
    console.log(`Shared department names: ${[...sharedDeptNames].join(", ")}`);
    console.log(`${candidates.length} affected student(s):`);
    for (const c of candidates) {
      console.log(
        `  ${c.name}${c.rollNumber ? ` (${c.rollNumber})` : ""} - Year ${c.year}, Section ${c.section || "unassigned"}: `
          + `department "${c.currentDepartment}" -> "${c.restoreDepartment}", secondaryDepartment -> "${c.newSecondaryDepartment}"`
      );
    }
    totalCandidates += candidates.length;

    if (APPLY) {
      const batch = db.batch();
      const now = new Date();
      for (const c of candidates) {
        const studentRef = collegeRef.collection("students").doc(c.id);
        batch.update(studentRef, {
          department: c.restoreDepartment,
          secondaryDepartment: c.newSecondaryDepartment,
          updatedAt: now,
        });
        const historyRef = studentRef.collection("departmentHistory").doc();
        batch.set(historyRef, {
          department: c.restoreDepartment,
          section: c.section,
          year: c.year,
          from: now,
          note: "repair-shared-year-student-departments",
        });
      }
      await batch.commit();
      totalRepaired += candidates.length;
      console.log(`  Repaired ${candidates.length} student(s).`);
    }
  }

  if (totalCandidates === 0) {
    console.log("\nNo affected students found across any college. Nothing to do.");
  } else if (APPLY) {
    console.log(`\nRepaired ${totalRepaired} student(s) total across all colleges.`);
  } else {
    console.log(`\nWould repair ${totalCandidates} student(s) total across all colleges.`);
    console.log("Dry run only - re-run with --apply to write these changes.");
  }
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
