import { readFileSync } from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";

// ── Edit these lines ────────────────────────────────────────────────────────
const SERVICE_ACCOUNT_PATH = "./service-account.json";
const COLLEGE_ID = "d3318ccbfbc1450c6ce8"; // QA College
// ─────────────────────────────────────────────────────────────────────────────

try {
  const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));
  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount) });
  }
} catch (err) {
  console.error("Failed to load service account credentials.", err.message);
  process.exit(1);
}

const db = getFirestore();

function generateId() {
  return crypto.randomBytes(10).toString("hex");
}

async function run() {
  console.log("Starting Academic Data Seed (Subjects & Teaching Assignments)...");
  const collegeRef = db.collection("colleges").doc(COLLEGE_ID);
  
  // Fetch existing data
  const [deptSnap, facultySnap, courseSnap, sectionSnap] = await Promise.all([
      collegeRef.collection("departments").get(),
      collegeRef.collection("facultyMembers").get(),
      collegeRef.collection("courses").get(),
      collegeRef.collection("sections").get()
  ]);

  if (deptSnap.empty) {
      console.error("No departments found! Are you sure the COLLEGE_ID is correct?");
      process.exit(1);
  }

  // Organize Data
  const facultyByDept = {};
  facultySnap.docs.forEach(doc => {
      const f = doc.data();
      if (!facultyByDept[f.department]) facultyByDept[f.department] = [];
      facultyByDept[f.department].push(f);
  });

  const sectionsByDeptAndCourse = {};
  sectionSnap.docs.forEach(doc => {
      const s = doc.data();
      if (!sectionsByDeptAndCourse[s.department]) sectionsByDeptAndCourse[s.department] = {};
      if (!sectionsByDeptAndCourse[s.department][s.courseId]) sectionsByDeptAndCourse[s.department][s.courseId] = [];
      sectionsByDeptAndCourse[s.department][s.courseId].push(s);
  });

  const coursesByDept = {};
  courseSnap.docs.forEach(doc => {
      const c = doc.data();
      if (!coursesByDept[c.departmentId]) coursesByDept[c.departmentId] = [];
      coursesByDept[c.departmentId].push(c);
  });

  let batch = db.batch();
  let writeCount = 0;

  async function commitBatchIfNeeded() {
      if (writeCount >= 450) {
          await batch.commit();
          batch = db.batch();
          writeCount = 0;
      }
  }

  // Define Subjects for BTech and MTech
  const BTECH_SUBJECTS = [
      { name: "Mathematics - I (Linear Algebra & Calculus)", code: "R23-M1", type: "THEORY", category: "BSC", credits: 3, hours: 3 },
      { name: "Engineering Physics", code: "R23-EP", type: "THEORY", category: "BSC", credits: 3, hours: 3 },
      { name: "Engineering Chemistry", code: "R23-EC", type: "THEORY", category: "BSC", credits: 3, hours: 3 },
      { name: "Communicative English", code: "R23-CE", type: "THEORY", category: "HSMC", credits: 2, hours: 2 },
      { name: "Programming for Problem Solving Using C", code: "R23-PPS", type: "THEORY", category: "ESC", credits: 3, hours: 3 },
      { name: "Programming for Problem Solving Using C Lab", code: "R23-PPSL", type: "PRACTICAL", category: "ESC", credits: 1.5, hours: 3 },
  ];

  const MTECH_SUBJECTS = [
      { name: "Advanced Data Structures", code: "MT-ADS", type: "THEORY", category: "PCC", credits: 3, hours: 3 },
      { name: "Machine Learning Techniques", code: "MT-ML", type: "THEORY", category: "PCC", credits: 3, hours: 3 },
  ];

  for (const deptDoc of deptSnap.docs) {
      const dept = deptDoc.data();
      const deptCode = dept.code;
      const deptFaculty = facultyByDept[deptCode] || [];
      const deptCourses = coursesByDept[dept.id] || [];

      if (deptFaculty.length === 0) continue;

      console.log(`\nProcessing Department: ${deptCode}`);

      for (const course of deptCourses) {
          const isBTech = course.code === "BTECH";
          const templates = isBTech ? BTECH_SUBJECTS : MTECH_SUBJECTS;
          const courseSections = (sectionsByDeptAndCourse[deptCode] && sectionsByDeptAndCourse[deptCode][course.id]) || [];
          
          if (courseSections.length === 0) continue;

          // 1. Create Subjects for this Course
          const createdSubjects = [];
          for (let i = 0; i < templates.length; i++) {
              const tmpl = templates[i];
              const subjectId = generateId();
              const subjectRef = collegeRef.collection("subjects").doc(subjectId);
              
              const subjectData = {
                  id: subjectId,
                  collegeId: COLLEGE_ID,
                  department: deptCode,
                  departmentId: dept.id,
                  courseId: course.id,
                  courseName: course.name,
                  year: 1, // We created Year 1 sections only
                  regulation: "R23",
                  serialNumber: i + 1,
                  category: tmpl.category,
                  name: tmpl.name,
                  code: tmpl.code,
                  hoursPerWeek: tmpl.hours,
                  credits: tmpl.credits,
                  type: tmpl.type,
                  isActive: true,
                  createdAt: FieldValue.serverTimestamp(),
                  updatedAt: FieldValue.serverTimestamp(),
              };
              
              batch.set(subjectRef, subjectData);
              createdSubjects.push(subjectData);
              writeCount++;
              await commitBatchIfNeeded();
          }

          // 2. Create Teaching Assignments for each Section
          for (const section of courseSections) {
              for (const subject of createdSubjects) {
                  // Pick a random faculty
                  const randomFaculty = deptFaculty[Math.floor(Math.random() * deptFaculty.length)];
                  
                  const assignmentId = generateId();
                  const assignmentRef = collegeRef.collection("teachingAssignments").doc(assignmentId);
                  
                  batch.set(assignmentRef, {
                      id: assignmentId,
                      collegeId: COLLEGE_ID,
                      facultyId: randomFaculty.id,
                      facultyName: randomFaculty.name,
                      department: deptCode,
                      departmentId: dept.id,
                      courseId: course.id,
                      courseName: course.name,
                      year: section.year,
                      sectionId: section.id,
                      sectionName: section.name,
                      subjectId: subject.id,
                      subjectName: subject.name,
                      subjectCode: subject.code,
                      hoursPerWeek: subject.hoursPerWeek,
                      assignedBy: "admin",
                      assignedByName: "System Admin",
                      createdAt: FieldValue.serverTimestamp(),
                      updatedAt: FieldValue.serverTimestamp()
                  });
                  writeCount++;
                  await commitBatchIfNeeded();
              }
              console.log(`  Assigned ${createdSubjects.length} subjects for ${course.code} Section ${section.name}`);
          }
      }
  }

  if (writeCount > 0) {
      await batch.commit();
  }

  console.log("\n✅ Academic Data Seed completed successfully!");
  console.log("Subjects and Teaching Assignments have been created for all sections.");
}

run().catch((err) => {
  console.error("Error running seed script:", err);
  process.exit(1);
});
