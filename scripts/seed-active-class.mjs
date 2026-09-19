import { readFileSync } from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";

const SERVICE_ACCOUNT_PATH = "./service-account.json";
const COLLEGE_ID = "d3318ccbfbc1450c6ce8"; // QA College

try {
  const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));
  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount) });
  }
} catch (err) {
  process.exit(1);
}

const db = getFirestore();

function generateId() {
  return crypto.randomBytes(10).toString("hex");
}

async function run() {
  console.log("Forcing an active class for Dr. Anil Verma...");
  
  const collegeRef = db.collection("colleges").doc(COLLEGE_ID);
  
  // Find Dr. Anil Verma
  const facultySnap = await collegeRef.collection("facultyMembers").where("email", "==", "faculty2.cse@qa.in").limit(1).get();
  if (facultySnap.empty) {
      console.log("Could not find Dr. Anil Verma");
      return;
  }
  const anil = facultySnap.docs[0].data();
  
  // Find one of his teaching assignments
  const assignmentSnap = await collegeRef.collection("teachingAssignments").where("facultyId", "==", anil.id).limit(1).get();
  if (assignmentSnap.empty) {
      console.log("No assignments found for Dr. Anil Verma");
      return;
  }
  const assignment = assignmentSnap.docs[0].data();

  // Create slots for today (Saturday) for the next few periods so it's active whenever he checks
  // Period 3: 10:50 - 11:40
  // Period 4: 11:40 - 12:30
  // Period 5: 13:10 - 14:00
  // Period 6: 14:00 - 14:50
  // Period 7: 14:50 - 15:40
  const periodsToActivate = [3, 4, 5, 6, 7];
  const batch = db.batch();

  for (const periodNumber of periodsToActivate) {
      const slotId = generateId();
      const slotRef = collegeRef.collection("timetableSlots").doc(slotId);
      batch.set(slotRef, {
          id: slotId,
          collegeId: COLLEGE_ID,
          department: assignment.department,
          assignmentId: assignment.id,
          facultyId: assignment.facultyId,
          facultyName: assignment.facultyName,
          courseId: assignment.courseId,
          year: assignment.year,
          sectionId: assignment.sectionId,
          subjectId: assignment.subjectId,
          subjectName: assignment.subjectName,
          day: "SAT", // Saturday
          periodNumber: periodNumber,
          source: "MANUAL",
          isPinned: true,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
      });
  }

  await batch.commit();
  console.log(`✅ Successfully published Timetable Slots for ${assignment.subjectName} (Section ${assignment.sectionName})!`);
  console.log("Dr. Anil Verma should now see this class actively running in the Attendance UI.");
}

run();
