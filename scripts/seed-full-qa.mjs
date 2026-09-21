import { readFileSync } from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";

// ── Edit these lines ────────────────────────────────────────────────────────
// Path to your service account JSON file
const SERVICE_ACCOUNT_PATH = "./service-account.json"; // We already created this
const DEFAULT_PASSWORD = "12345678";
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

const FIRST_NAMES = ["Aarav", "Vihaan", "Aditya", "Arjun", "Sai", "Reyansh", "Krishna", "Ishaan", "Shaurya", "Atharv", "Rahul", "Vikram", "Sanjay", "Anil", "Sunil", "Rajesh", "Ramesh", "Suresh", "Aadya", "Diya", "Saanvi", "Ananya", "Priya", "Neha", "Pooja", "Aarti", "Sneha", "Kavya", "Swati", "Nandini", "Riya", "Isha"];
const LAST_NAMES = ["Sharma", "Verma", "Reddy", "Patil", "Rao", "Deshmukh", "Singh", "Kumar", "Iyer", "Pillai", "Nair", "Menon", "Joshi", "Kulkarni", "Deshpande", "Choudhury", "Gupta", "Das", "Mukherjee", "Bose"];

function getRandomName() {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${first} ${last}`;
}

async function batchWrite(writes) {
    let batches = [];
    let currentBatch = db.batch();
    let count = 0;

    for (const write of writes) {
        write(currentBatch);
        count++;
        if (count === 490) {
            batches.push(currentBatch.commit());
            currentBatch = db.batch();
            count = 0;
        }
    }
    if (count > 0) {
        batches.push(currentBatch.commit());
    }
    await Promise.all(batches);
}

async function run() {
  console.log("Starting QA database seed...");

  // 1. Create Location
  const locationId = generateId();
  await db.collection("locations").doc(locationId).set({
    id: locationId,
    name: "QA - Location",
    city: "Hyderabad",
    state: "Telangana",
    address: "QA Campus, Hitech City",
    isActive: true,
    createdAt: FieldValue.serverTimestamp()
  });
  console.log(`✓ Created Location: ${locationId}`);

  // 2. Create College
  const collegeId = generateId();
  await db.collection("colleges").doc(collegeId).set({
    id: collegeId,
    locationId: locationId,
    name: "QA Engineering College",
    type: "ENGINEERING",
    address: "QA Campus Road",
    isActive: true,
    createdAt: FieldValue.serverTimestamp()
  });
  console.log(`✓ Created College: ${collegeId}`);

  // 3. Create Course Catalog
  const btechCatalogId = generateId();
  const mtechCatalogId = generateId();
  await db.collection("colleges").doc(collegeId).collection("coursesCatalog").doc(btechCatalogId).set({
    id: btechCatalogId,
    collegeId,
    name: "Bachelor of Technology",
    code: "B.Tech",
    durationYears: 4,
    isActive: true,
    createdAt: FieldValue.serverTimestamp()
  });
  await db.collection("colleges").doc(collegeId).collection("coursesCatalog").doc(mtechCatalogId).set({
    id: mtechCatalogId,
    collegeId,
    name: "Master of Technology",
    code: "M.Tech",
    durationYears: 2,
    isActive: true,
    createdAt: FieldValue.serverTimestamp()
  });
  console.log(`✓ Created Course Catalog Items`);

  // Helper for Top-Level Users
  async function provisionTopLevelUser({ email, name, role, designation }) {
    console.log(`\nProvisioning ${role} (${email})...`);
    
    // Auth
    try {
      await authAdmin.getUserByEmail(email);
      const existingUser = await authAdmin.getUserByEmail(email);
      await authAdmin.deleteUser(existingUser.uid);
    } catch (e) {
      if (e.code !== "auth/user-not-found") throw e;
    }

    const authUser = await authAdmin.createUser({
      email,
      password: DEFAULT_PASSWORD,
      displayName: name,
    });
    
    await authAdmin.setCustomUserClaims(authUser.uid, { role, collegeId });

    // Profiles
    await db.collection("colleges").doc(collegeId).collection("users").doc(authUser.uid).set({
      uid: authUser.uid,
      collegeId,
      name,
      email,
      role,
      isActive: true,
      designation,
      createdAt: FieldValue.serverTimestamp(),
    });
    
    await db.collection("systemUsers").doc(authUser.uid).set({
      role,
      collegeId,
      name,
      email,
      isActive: true,
    });

    return authUser.uid;
  }

  // Provision Principal & VP
  const principalUid = await provisionTopLevelUser({
    email: "principal@qa.in",
    name: "Dr. QA Principal",
    role: "PRINCIPAL",
    designation: "Principal"
  });
  const vpUid = await provisionTopLevelUser({
    email: "viceprincipal@qa.in",
    name: "Dr. QA Vice Principal",
    role: "VICE_PRINCIPAL",
    designation: "Vice Principal"
  });

  const DEPARTMENTS = ["CSE", "ECE", "AIML", "AIDS"];
  const allStudentWrites = [];
  
  for (const deptCode of DEPARTMENTS) {
    console.log(`\n--- Setting up Department: ${deptCode} ---`);
    const deptId = generateId();
    
    // Create Department
    await db.collection("colleges").doc(collegeId).collection("departments").doc(deptId).set({
      id: deptId,
      collegeId: collegeId,
      name: deptCode === "CSE" ? "Computer Science and Engineering" : deptCode === "ECE" ? "Electronics and Communication Engineering" : deptCode === "AIML" ? "AI and Machine Learning" : "AI and Data Science",
      code: deptCode,
      isActive: true,
      hasSubDepartments: false,
      assignedYears: [1, 2, 3, 4],
      createdAt: FieldValue.serverTimestamp()
    });

    // Create Courses for this Dept
    const btechCourseId = generateId();
    const mtechCourseId = generateId();
    
    await db.collection("colleges").doc(collegeId).collection("courses").doc(btechCourseId).set({
      id: btechCourseId,
      collegeId,
      departmentId: deptId,
      catalogId: btechCatalogId,
      name: "B.Tech",
      code: "BTECH",
      durationYears: 4,
      isActive: true,
      createdAt: FieldValue.serverTimestamp()
    });
    
    await db.collection("colleges").doc(collegeId).collection("courses").doc(mtechCourseId).set({
      id: mtechCourseId,
      collegeId,
      departmentId: deptId,
      catalogId: mtechCatalogId,
      name: "M.Tech",
      code: "MTECH",
      durationYears: 2,
      isActive: true,
      createdAt: FieldValue.serverTimestamp()
    });

    // Provision 1 HOD and 9 Faculty sequentially for Auth accounts
    let hodUid = null;
    let hodName = null;
    for (let i = 1; i <= 10; i++) {
        const isHod = i === 1;
        const role = isHod ? "HOD" : "PANEL_MEMBER";
        const email = isHod ? `hod.${deptCode.toLowerCase()}@qa.in` : `faculty${i}.${deptCode.toLowerCase()}@qa.in`;
        const name = `Dr. ${getRandomName()}`;
        
        try {
            await authAdmin.getUserByEmail(email).then(u => authAdmin.deleteUser(u.uid)).catch(e => { if(e.code !== "auth/user-not-found") throw e; });
        } catch(e) {}
        
        const authUser = await authAdmin.createUser({
            email,
            password: DEFAULT_PASSWORD,
            displayName: name,
        });

        await authAdmin.setCustomUserClaims(authUser.uid, { role, collegeId });
        
        await db.collection("colleges").doc(collegeId).collection("users").doc(authUser.uid).set({
            uid: authUser.uid,
            collegeId,
            name,
            email,
            role,
            department: deptCode,
            isActive: true,
            createdAt: FieldValue.serverTimestamp(),
        });
        
        await db.collection("systemUsers").doc(authUser.uid).set({
            role,
            collegeId,
            name,
            email,
            isActive: true,
        });

        const facultyRef = db.collection("colleges").doc(collegeId).collection("facultyMembers").doc();
        await facultyRef.set({
            id: facultyRef.id,
            collegeId,
            department: deptCode,
            employeeId: `EMP-${deptCode}-${i}`,
            legalName: name.toUpperCase(),
            email,
            collegeEmail: email,
            designation: isHod ? "Professor" : "Assistant Professor",
            highestQualification: "Ph.D",
            totalYearsOfExperience: isHod ? 15 : Math.floor(Math.random() * 10) + 1,
            joiningDate: FieldValue.serverTimestamp(),
            status: "ACTIVE",
            userUid: authUser.uid,
            isActive: true,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        if (isHod) {
            hodUid = authUser.uid;
            hodName = name;
        }
        console.log(`  Provisioned Faculty: ${email}`);
    }

    // Update Dept with HOD
    await db.collection("colleges").doc(collegeId).collection("departments").doc(deptId).update({
        hodUid,
        hodName
    });

    // Create Sections & prepare Student batch writes
    const sectionsToCreate = [
        { name: "A", type: "BTECH", courseId: btechCourseId, year: 1 },
        { name: "B", type: "BTECH", courseId: btechCourseId, year: 1 },
        { name: "C", type: "BTECH", courseId: btechCourseId, year: 1 },
        { name: "D", type: "BTECH", courseId: btechCourseId, year: 1 },
        { name: "A", type: "MTECH", courseId: mtechCourseId, year: 1 },
        { name: "B", type: "MTECH", courseId: mtechCourseId, year: 1 },
    ];

    for (const sec of sectionsToCreate) {
        const sectionId = generateId();
        await db.collection("colleges").doc(collegeId).collection("sections").doc(sectionId).set({
            id: sectionId,
            collegeId,
            department: deptCode,
            courseId: sec.courseId,
            courseName: sec.type,
            name: sec.name,
            year: sec.year,
            batch: "2024-2028",
            studentCount: 60,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        
        console.log(`  Created Section ${sec.type} - ${sec.name} (${deptCode})`);

        // Generate 60 students for this section
        for (let s = 1; s <= 60; s++) {
            const studentId = generateId();
            const rollNumber = `24${deptCode}${sec.type.charAt(0)}${sec.name}${s.toString().padStart(2, '0')}`;
            const studentName = getRandomName();
            
            allStudentWrites.push((batch) => {
                const studentRef = db.collection("colleges").doc(collegeId).collection("students").doc(studentId);
                batch.set(studentRef, {
                    id: studentId,
                    collegeId,
                    department: deptCode,
                    section: sec.name,
                    year: sec.year,
                    rollNumber,
                    name: studentName,
                    status: "REGULAR",
                    batch: "2024-2028",
                    courseId: sec.courseId,
                    email: `${studentName.replace(" ", ".").toLowerCase()}@qa.in`,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            });
        }
    }
  }

  console.log(`\nWriting 1440 student records to Firestore via Batches...`);
  await batchWrite(allStudentWrites);

  console.log("\n✅ QA Database seed completed successfully!");
  console.log("-----------------------------------------");
  console.log(`All Passwords: ${DEFAULT_PASSWORD}`);
  console.log(`Principal: principal@qa.in`);
  console.log(`Vice Principal: viceprincipal@qa.in`);
  console.log(`HOD CSE: hod.cse@qa.in`);
  console.log(`Faculty 1 CSE: faculty1.cse@qa.in`);
  console.log(`... and similarly for ECE, AIML, AIDS`);
  console.log("-----------------------------------------");
}

run().catch((err) => {
  console.error("Error running seed script:", err);
  process.exit(1);
});
