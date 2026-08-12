/**
 * Read-only diagnostic: for every college, print each department's scoping
 * fields (parentDepartmentId, hasSubDepartments, assignedYears,
 * secondaryDepartments, managedDepartments) and each section's
 * department/secondaryDepartments/year. Used to explain why sections from one
 * department show up under another department's HOD (managed-branch rollup or
 * secondary cross-listing). Reads only - writes nothing.
 *
 * Usage: node scripts/diagnose-department-scope.mjs
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
const arr = (v) => (Array.isArray(v) && v.length ? `[${v.join(", ")}]` : "-");

async function run() {
  const collegesSnap = await db.collection("colleges").get();

  for (const collegeDoc of collegesSnap.docs) {
    const collegeRef = collegeDoc.ref;
    const [deptsSnap, sectionsSnap] = await Promise.all([
      collegeRef.collection("departments").get(),
      collegeRef.collection("sections").get(),
    ]);

    // Only report colleges that actually have a Basic Science department, to
    // keep the output focused on the one being investigated.
    const hasBasicScience = deptsSnap.docs.some(
      (d) => (d.data().name ?? "").trim().toLowerCase() === "basic science"
    );
    if (!hasBasicScience) continue;

    console.log(`\n=== College ${collegeDoc.id} (${collegeDoc.data().name ?? "?"}) ===`);

    const nameById = new Map(deptsSnap.docs.map((d) => [d.id, d.data().name ?? d.id]));

    console.log(`-- departments (${deptsSnap.size}) --`);
    for (const d of deptsSnap.docs) {
      const x = d.data();
      const parent = x.parentDepartmentId ? ` parentOf=${nameById.get(x.parentDepartmentId) ?? x.parentDepartmentId}` : "";
      console.log(
        `  ${x.name}` +
          `\n      id=${d.id}${parent}` +
          `\n      hasSubDepartments=${!!x.hasSubDepartments}  assignedYears=${arr(x.assignedYears)}` +
          `\n      secondaryDepartments=${arr(x.secondaryDepartments)}  managedDepartments=${arr(x.managedDepartments)}`
      );
    }

    console.log(`-- sections (${sectionsSnap.size}) --`);
    if (sectionsSnap.empty) console.log("  (none)");
    for (const s of sectionsSnap.docs) {
      const x = s.data();
      console.log(
        `  dept=${x.department}  name=${x.name}  year=${x.year}  course=${x.courseName ?? x.courseId}  secondary=${arr(x.secondaryDepartments)}`
      );
    }

    // Explicit leak explanation: which departments' HODs can see sections that
    // are NOT their own department or a sub-department.
    console.log(`-- who-sees-whom (managed/secondary rollup) --`);
    for (const d of deptsSnap.docs) {
      const x = d.data();
      if (x.parentDepartmentId) continue; // report from the top-level HOD's POV
      const childNames = deptsSnap.docs
        .filter((c) => c.data().parentDepartmentId === d.id)
        .map((c) => c.data().name);
      // Managed rollup: own managed + children's managed.
      const managed = new Set(x.managedDepartments ?? []);
      for (const c of deptsSnap.docs) {
        if (c.data().parentDepartmentId === d.id) {
          for (const m of c.data().managedDepartments ?? []) managed.add(m);
        }
      }
      const managedList = [...managed];
      if (managedList.length || childNames.length) {
        console.log(
          `  ${x.name} HOD sees (primary/editable): own + subs${childNames.length ? ` ${arr(childNames)}` : ""}` +
            `${managedList.length ? ` + MANAGED ${arr(managedList)}  <-- extra departments` : ""}`
        );
      }
    }
  }

  console.log("\nDone (read-only).");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
