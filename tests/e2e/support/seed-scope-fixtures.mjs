/**
 * Opt-in seed script for tests/e2e/api/faculty-scope-security.spec.ts.
 *
 * Creates (or reuses, if already present) exactly the fixtures that spec
 * needs: a parent department with a true child sub-department AND a
 * managed/grouped branch it does NOT own, a sub-HOD Firebase Auth account
 * scoped to that child department, that branch's own recorded HOD login (for
 * the link-hod positive case), and two facultyMembers docs with no login yet
 * (one in the sub-HOD's own department, one in the managed branch).
 *
 * This writes real Firebase Auth users and Firestore documents using the
 * Admin SDK - NEVER point FIREBASE_ADMIN_PROJECT_ID at a production project
 * when running this. It is deliberately NOT wired into `npm run test:e2e` -
 * run it once, by hand, against a non-production Firebase project, then copy
 * its printed output into tests/e2e/.env.test. Re-running it is safe (each
 * step checks for the existing user/department by name first).
 *
 * Usage:
 *   1. Point the FIREBASE_ADMIN_* vars (root .env) at a non-production project.
 *   2. node tests/e2e/support/seed-scope-fixtures.mjs <collegeId>
 *   3. Copy the printed env vars into tests/e2e/.env.test.
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const [, , COLLEGE_ID] = process.argv;
if (!COLLEGE_ID) {
  console.error("Usage: node tests/e2e/support/seed-scope-fixtures.mjs <collegeId>");
  console.error("(collegeId must already exist - create a college via the app or Super Admin first)");
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const authAdmin = getAuth();
const db = getFirestore();
const collegeRef = db.collection("colleges").doc(COLLEGE_ID);

const PARENT_DEPT = "E2E Scope Parent";
const CHILD_DEPT = "E2E Scope Child";
const MANAGED_DEPT = "E2E Scope Managed Branch";
const SUBHOD_EMAIL = "e2e-subhod@example-college.test";
const SUBHOD_PASSWORD = "TestPassword123!";
const MANAGED_HOD_EMAIL = "e2e-managed-hod@example-college.test";
const MANAGED_HOD_PASSWORD = "TestPassword123!";

async function upsertAuthUser(email, password, displayName) {
  try {
    const user = await authAdmin.createUser({ email, password, displayName });
    return user.uid;
  } catch (err) {
    if (err.code === "auth/email-already-exists") {
      return (await authAdmin.getUserByEmail(email)).uid;
    }
    throw err;
  }
}

async function upsertDepartment(name, data) {
  const existing = await collegeRef.collection("departments").where("name", "==", name).limit(1).get();
  if (!existing.empty) {
    await existing.docs[0].ref.set(data, { merge: true });
    return existing.docs[0].id;
  }
  const ref = await collegeRef.collection("departments").add({ name, isActive: true, ...data, createdAt: new Date() });
  return ref.id;
}

async function upsertFacultyMember(department, employeeIdSuffix) {
  const employeeId = `E2E-SEED-${employeeIdSuffix}`;
  const existing = await collegeRef.collection("facultyMembers").where("employeeId", "==", employeeId).limit(1).get();
  if (!existing.empty) return existing.docs[0].id;
  const ref = await collegeRef.collection("facultyMembers").add({
    collegeId: COLLEGE_ID,
    department,
    employeeId,
    collegeEmail: `${employeeId.toLowerCase()}@example-college.test`,
    mobileNo: "9000000002",
    designation: "Assistant Professor",
    highestQualification: "Ph.D",
    totalYearsOfExperience: 0,
    joiningDate: new Date("2020-06-01"),
    status: "ACTIVE",
    legalName: `Seed Faculty ${employeeIdSuffix}`,
    gender: "Other",
    dateOfBirth: new Date("1990-01-01"),
    aadharNo: `E2E-AADHAR-SEED-${employeeIdSuffix}`,
    panNo: `E2EPANSEED${employeeIdSuffix}`,
    ratificationStatus: "Not Ratified",
    createdAt: new Date(),
    updatedAt: new Date(),
    // Deliberately no userUid - both scope-security login-creation tests need
    // a faculty record that does NOT already have a login.
  });
  return ref.id;
}

async function run() {
  const childId = await upsertDepartment(CHILD_DEPT, { parentDepartmentId: null });
  const parentId = await upsertDepartment(PARENT_DEPT, { hasSubDepartments: true });
  await collegeRef.collection("departments").doc(childId).set({ parentDepartmentId: parentId }, { merge: true });

  await upsertDepartment(MANAGED_DEPT, {});
  // The child sub-department manages MANAGED_DEPT - this is the exact shape
  // canHodManageFacultyDepartment's doc-comment describes: full edit rights
  // over sections/subjects/timetable, but never that branch's own faculty.
  await collegeRef.collection("departments").doc(childId).set(
    { managedDepartments: FieldValue.arrayUnion(MANAGED_DEPT) },
    { merge: true }
  );

  const subHodUid = await upsertAuthUser(SUBHOD_EMAIL, SUBHOD_PASSWORD, "E2E Sub-HOD");
  await collegeRef.collection("users").doc(subHodUid).set({
    uid: subHodUid, collegeId: COLLEGE_ID, name: "E2E Sub-HOD", email: SUBHOD_EMAIL,
    role: "HOD", department: CHILD_DEPT, departments: [CHILD_DEPT],
    isActive: true, createdAt: new Date(), updatedAt: new Date(),
  }, { merge: true });
  await db.collection("systemUsers").doc(subHodUid).set({
    uid: subHodUid, role: "HOD", collegeId: COLLEGE_ID, email: SUBHOD_EMAIL, name: "E2E Sub-HOD",
  }, { merge: true });

  // A second HOD-role login already recorded against CHILD_DEPT - link-hod's
  // POST /api/college/faculty/link-hod positive case (see the spec) links
  // this login into a facultyMembers profile, which requires the target to
  // already be "isThisDepartmentsHod" (role HOD, department === CHILD_DEPT).
  const linkTargetUid = await upsertAuthUser(MANAGED_HOD_EMAIL, MANAGED_HOD_PASSWORD, "E2E Own-Dept HOD For Linking");
  await collegeRef.collection("users").doc(linkTargetUid).set({
    uid: linkTargetUid, collegeId: COLLEGE_ID, name: "E2E Own-Dept HOD For Linking", email: MANAGED_HOD_EMAIL,
    role: "HOD", department: CHILD_DEPT, departments: [CHILD_DEPT],
    isActive: true, createdAt: new Date(), updatedAt: new Date(),
  }, { merge: true });

  const facultyOwn = await upsertFacultyMember(CHILD_DEPT, "OWN");
  const facultyManaged = await upsertFacultyMember(MANAGED_DEPT, "MANAGED");

  console.log("\nSeeded. Add these to tests/e2e/.env.test:\n");
  console.log(`E2E_FIREBASE_API_KEY=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "<copy from root .env>"}`);
  console.log(`E2E_SUBHOD_EMAIL=${SUBHOD_EMAIL}`);
  console.log(`E2E_SUBHOD_PASSWORD=${SUBHOD_PASSWORD}`);
  console.log(`E2E_SUBHOD_OWN_DEPARTMENT=${CHILD_DEPT}`);
  console.log(`E2E_SUBHOD_MANAGED_DEPARTMENT=${MANAGED_DEPT}`);
  console.log(`E2E_LINK_HOD_TARGET_UID=${linkTargetUid}`);
  console.log(`E2E_FACULTY_ID_IN_OWN_DEPARTMENT=${facultyOwn}`);
  console.log(`E2E_FACULTY_ID_IN_MANAGED_DEPARTMENT=${facultyManaged}`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
