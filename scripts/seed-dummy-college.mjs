import { readFileSync } from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";

// ── Edit these lines ────────────────────────────────────────────────────────
// Path to your service account JSON file
const SERVICE_ACCOUNT_PATH = "C:/Users/gurun/Documents/VTH/Faculty-Managment/service-account.json";
const DEFAULT_PASSWORD = "password123";
// ─────────────────────────────────────────────────────────────────────────────

try {
  const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));
  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount) });
  }
} catch (err) {
  console.error("Failed to load service account credentials.", err.message);
  console.error("Please update SERVICE_ACCOUNT_PATH at the top of this script.");
  process.exit(1);
}

const authAdmin = getAuth();
const db = getFirestore();

function generateId() {
  return crypto.randomBytes(10).toString("hex");
}

async function run() {
  console.log("Starting database seed...");

  // 1. Create Location
  const locationId = generateId();
  await db.collection("locations").doc(locationId).set({
    id: locationId,
    name: "DUMMY - Location",
    city: "Dummy City",
    state: "Dummy State",
    address: "123 Dummy St",
    isActive: true,
    createdAt: FieldValue.serverTimestamp()
  });
  console.log(`✓ Created Location: ${locationId}`);

  // 2. Create College
  const collegeId = generateId();
  await db.collection("colleges").doc(collegeId).set({
    id: collegeId,
    locationId: locationId,
    name: "Dummy Engineering College",
    type: "ENGINEERING",
    address: "123 Dummy Campus Road",
    isActive: true,
    createdAt: FieldValue.serverTimestamp()
  });
  console.log(`✓ Created College: ${collegeId}`);

  // 3. Create Department
  const deptId = generateId();
  await db.collection("colleges").doc(collegeId).collection("departments").doc(deptId).set({
    id: deptId,
    collegeId: collegeId,
    name: "Computer Science and Engineering",
    code: "CSE",
    isActive: true,
    hasSubDepartments: false,
    createdAt: FieldValue.serverTimestamp()
  });
  console.log(`✓ Created Department (CSE): ${deptId}`);

  // Helper to create a user across Auth, systemUsers, and college users
  async function provisionUser({ uid, email, name, role, isFaculty, department, designation, experience }) {
    console.log(`\nProvisioning ${role} (${email})...`);
    
    // Auth
    try {
      await authAdmin.getUserByEmail(email);
      console.log(`  User ${email} already exists in Auth. Deleting for fresh seed...`);
      const existingUser = await authAdmin.getUserByEmail(email);
      await authAdmin.deleteUser(existingUser.uid);
    } catch (e) {
      if (e.code !== "auth/user-not-found") throw e;
    }

    const authUser = await authAdmin.createUser({
      uid,
      email,
      password: DEFAULT_PASSWORD,
      displayName: name,
    });
    console.log(`  Created Auth User: ${authUser.uid}`);

    // Custom claims
    let customClaims = { role, collegeId };
    if (role === "ADMINISTRATION" || role === "HR_ADMIN" || role === "ADMIN_OFFICE" || role === "LOCATION_DEPT_HEAD") {
        customClaims = { role, locationId };
    }
    await authAdmin.setCustomUserClaims(authUser.uid, customClaims);

    const fmsUser = {
      uid: authUser.uid,
      collegeId,
      name,
      email,
      role,
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
      ...(department && { department }),
      ...(designation && { designation }),
    };

    // FMS User doc (college-scoped)
    await db.collection("colleges").doc(collegeId).collection("users").doc(authUser.uid).set(fmsUser);
    
    // systemUsers doc (global routing)
    await db.collection("systemUsers").doc(authUser.uid).set({
      role,
      collegeId,
      name,
      email,
      isActive: true,
    });
    console.log(`  Created Profiles (users, systemUsers)`);

    // Faculty member profile (if applicable)
    if (isFaculty) {
      const facultyRef = db.collection("colleges").doc(collegeId).collection("facultyMembers").doc();
      const employeeId = `DUMMY-${generateId().slice(0, 4).toUpperCase()}`;
      
      await facultyRef.set({
        id: facultyRef.id,
        collegeId,
        department: department || "",
        employeeId,
        name,
        legalName: name.toUpperCase(),
        email,
        collegeEmail: email,
        designation: designation || "Professor",
        qualification: "Ph.D",
        experienceYears: experience || 5,
        joiningDate: FieldValue.serverTimestamp(),
        status: "ACTIVE",
        userUid: authUser.uid,
        isActive: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      console.log(`  Created Faculty Profile: ${facultyRef.id}`);

      // If this is the HOD, update the department to point to them
      if (role === "HOD") {
         await db.collection("colleges").doc(collegeId).collection("departments").doc(deptId).update({
             hodUid: authUser.uid,
             hodName: name
         });
         console.log(`  Set as HOD for department ${deptId}`);
      }
    }
    
    return authUser;
  }

  // 4. Create Dummy Users
  await provisionUser({
    uid: "dummy-principal",
    email: "principal@dummycollege.edu",
    name: "Dr. Dummy Principal",
    role: "PRINCIPAL",
    isFaculty: true,
    designation: "Principal",
    experience: 20
  });

  await provisionUser({
    uid: "dummy-hod",
    email: "hod.cse@dummycollege.edu",
    name: "Dr. Dummy HOD",
    role: "HOD",
    isFaculty: true,
    department: "CSE",
    designation: "Professor",
    experience: 15
  });

  await provisionUser({
    uid: "dummy-faculty",
    email: "faculty@dummycollege.edu",
    name: "Dr. Dummy Faculty",
    role: "PANEL_MEMBER",
    isFaculty: true,
    department: "CSE",
    designation: "Assistant Professor",
    experience: 5
  });

  console.log("\n✅ Database seed completed successfully!");
  console.log("-----------------------------------------");
  console.log(`Login credentials (Password: ${DEFAULT_PASSWORD})`);
  console.log(`Principal: principal@dummycollege.edu`);
  console.log(`HOD: hod.cse@dummycollege.edu`);
  console.log(`Faculty: faculty@dummycollege.edu`);
  console.log("-----------------------------------------");
}

run().catch((err) => {
  console.error("Error running seed script:", err);
  process.exit(1);
});
