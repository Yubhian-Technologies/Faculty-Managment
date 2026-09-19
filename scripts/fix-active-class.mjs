import { readFileSync } from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const SERVICE_ACCOUNT_PATH = "./service-account.json";
const COLLEGE_ID = "d3318ccbfbc1450c6ce8";

try {
  const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));
  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount) });
  }
} catch (err) {
  process.exit(1);
}

const db = getFirestore();

async function run() {
  console.log("Fixing CourseYearTiming for Dr. Anil Verma's test class...");
  const collegeRef = db.collection("colleges").doc(COLLEGE_ID);
  
  // Find Dr. Anil Verma
  const facultySnap = await collegeRef.collection("facultyMembers").where("email", "==", "faculty2.cse@qa.in").limit(1).get();
  const anil = facultySnap.docs[0].data();
  
  // Find his assignment
  const assignmentSnap = await collegeRef.collection("teachingAssignments").where("facultyId", "==", anil.id).limit(1).get();
  const assignment = assignmentSnap.docs[0].data();

  const timingId = `${assignment.courseId}_year${assignment.year}`;
  
  // Create CourseYearTimings so that timetable slot resolution passes
  await collegeRef.collection("courseYearTimings").doc(timingId).set({
      id: timingId,
      collegeId: COLLEGE_ID,
      departmentId: assignment.departmentId,
      courseId: assignment.courseId,
      year: assignment.year,
      collegeStartTime: "09:00",
      collegeEndTime: "16:00",
      numberOfPeriods: 7,
      periodDurationMinutes: 50,
      lunchBreak: { startTime: "12:30", endTime: "13:10", durationMinutes: 40 },
      shortBreaks: [
          { startTime: "10:40", endTime: "10:50", durationMinutes: 10 }
      ],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
  });

  console.log("✅ Successfully created CourseYearTiming!");
  console.log("Attendance UI should now properly detect the active clock time.");
}

run();
