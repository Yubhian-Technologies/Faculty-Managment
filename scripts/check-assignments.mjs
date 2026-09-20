import { readFileSync } from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

async function run() {
  const snap = await db.collection("colleges").doc(COLLEGE_ID).collection("teachingAssignments").where("department", "==", "CSE").get();
  
  const facultyStats = {};
  snap.docs.forEach(doc => {
      const data = doc.data();
      const id = data.facultyId;
      if (!facultyStats[id]) {
          facultyStats[id] = { name: data.facultyName, count: 0 };
      }
      facultyStats[id].count++;
  });

  const facultySnap = await db.collection("colleges").doc(COLLEGE_ID).collection("facultyMembers").where("department", "==", "CSE").get();
  const emails = {};
  facultySnap.docs.forEach(doc => {
      emails[doc.data().id] = doc.data().email;
  });

  console.log("CSE Faculty Teaching Assignments Count with Emails:");
  Object.keys(facultyStats).forEach(id => {
      const stat = facultyStats[id];
      const email = emails[id];
      console.log(`- ${stat.name} | ${email} | Password: 12345678 -> ${stat.count} classes`);
  });
}

run();
