// Firestore rules regression test (emulator). Not part of vitest/playwright runs.
// Run: npm i --no-save @firebase/rules-unit-testing firebase && npx firebase emulators:exec --only firestore --project rules-test "node tests/rules/firestore.rules.test.mjs firestore.rules"
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, orderBy, limit } from "firebase/firestore";

const rulesPath = process.argv[2];
const env = await initializeTestEnvironment({
  projectId: "rules-test",
  firestore: { rules: readFileSync(rulesPath, "utf8"), host: "127.0.0.1", port: 8080 },
});
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "colleges/c1"), { name: "C1" });
  await setDoc(doc(db, "colleges/c1/users/hod1"), { role: "HOD", name: "H" });
  await setDoc(doc(db, "colleges/c1/users/fac1"), { role: "PANEL_MEMBER", name: "F" });
  await setDoc(doc(db, "colleges/c1/students/s1"), { uid: "stu1", name: "S" });
  await setDoc(doc(db, "colleges/c1/facultyMembers/fm1"), { name: "F" });
  await setDoc(doc(db, "colleges/c1/salaryRecords/r1"), { facultyId: "fac1" });
  await setDoc(doc(db, "colleges/c1/leaveRequests/l1"), { uid: "fac1" });
  await setDoc(doc(db, "colleges/c1/departments/d1"), { name: "CSE" });
  await setDoc(doc(db, "colleges/c1/timetableSlots/t1"), { day: "MON" });
  await setDoc(doc(db, "colleges/c1/sections/sec1"), { name: "A" });
  await setDoc(doc(db, "colleges/c1/teachingAssignments/ta1"), { x: 1 });
  await setDoc(doc(db, "colleges/c1/studentAttendance/sa1"), { facultyId: "fac1" });
  await setDoc(doc(db, "colleges/c1/notifications/n1"), { toUid: "hod1", read: false, createdAt: new Date() });
  await setDoc(doc(db, "systemUsers/sa1"), { role: "SUPER_ADMIN" });
  await setDoc(doc(db, "platformConfig/facultyNorms"), { a: 1 });
});
const as = (uid, role, collegeId = "c1") => env.authenticatedContext(uid, { role, collegeId }).firestore();
const hod = as("hod1", "HOD"), fac = as("fac1", "PANEL_MEMBER"), prin = as("p1", "PRINCIPAL"),
  stu = as("stu1", "STUDENT"), sa = as("sa1", "SUPER_ADMIN", undefined), other = as("x", "HOD", "c2");

let fail = 0;
const t = async (name, expectOk, fn) => {
  try { await (expectOk ? assertSucceeds(fn()) : assertFails(fn())); console.log("ok  ", name); }
  catch (e) { fail++; console.log("FAIL", name, "-", String(e.message).split("\n")[0]); }
};
// writes: all closed to clients
await t("PANEL_MEMBER cannot create studentAttendance", false, () => setDoc(doc(fac, "colleges/c1/studentAttendance/new"), { facultyId: "fac1", collegeId: "c1" }));
await t("PANEL_MEMBER cannot create internalExamMarks", false, () => setDoc(doc(fac, "colleges/c1/internalExamMarks/new"), { facultyId: "fac1", collegeId: "c1" }));
await t("HOD cannot write timetableSlots", false, () => setDoc(doc(hod, "colleges/c1/timetableSlots/t1"), { day: "TUE" }));
await t("HOD cannot write sections", false, () => updateDoc(doc(hod, "colleges/c1/sections/sec1"), { name: "B" }));
await t("HOD cannot write teachingAssignments", false, () => deleteDoc(doc(hod, "colleges/c1/teachingAssignments/ta1")));
await t("HOD cannot write students", false, () => updateDoc(doc(hod, "colleges/c1/students/s1"), { name: "X" }));
await t("PRINCIPAL cannot update facultyMembers", false, () => updateDoc(doc(prin, "colleges/c1/facultyMembers/fm1"), { name: "X" }));
await t("owner cannot self-update own user doc", false, () => updateDoc(doc(hod, "colleges/c1/users/hod1"), { name: "New" }));
await t("SUPER_ADMIN cannot write from the browser", false, () => setDoc(doc(sa, "colleges/c1/departments/d2"), { name: "ECE" }));
// reads kept
await t("user reads own profile (login)", true, () => getDoc(doc(hod, "colleges/c1/users/hod1")));
await t("student reads own student record", true, () => getDoc(doc(stu, "colleges/c1/students/s1")));
await t("SUPER_ADMIN reads users", true, () => getDoc(doc(sa, "colleges/c1/users/fac1")));
await t("staff still read departments", true, () => getDoc(doc(hod, "colleges/c1/departments/d1")));
await t("staff still read the college doc", true, () => getDoc(doc(hod, "colleges/c1")));
await t("owner reads own systemUsers doc", true, () => getDoc(doc(sa, "systemUsers/sa1")));
await t("any signed-in user reads platformConfig", true, () => getDoc(doc(fac, "platformConfig/facultyNorms")));
// live notification feed (onSnapshot on the signed-in user's own notifications)
await t("user can listen to own notifications", true, () => getDocs(query(collection(hod, "colleges/c1/notifications"), where("toUid", "==", "hod1"), orderBy("createdAt", "desc"), limit(30))));
await t("user cannot listen to someone else's notifications", false, () => getDocs(query(collection(fac, "colleges/c1/notifications"), where("toUid", "==", "hod1"))));
await t("user cannot write notifications", false, () => updateDoc(doc(hod, "colleges/c1/notifications/n1"), { read: true }));
// reads narrowed
await t("PANEL_MEMBER cannot read another user's profile", false, () => getDoc(doc(fac, "colleges/c1/users/hod1")));
await t("HOD cannot list the users collection", false, () => getDocs(collection(hod, "colleges/c1/users")));
await t("HOD cannot read salaryRecords", false, () => getDoc(doc(hod, "colleges/c1/salaryRecords/r1")));
await t("HOD cannot read facultyMembers", false, () => getDoc(doc(hod, "colleges/c1/facultyMembers/fm1")));
await t("HOD cannot read leaveRequests", false, () => getDoc(doc(hod, "colleges/c1/leaveRequests/l1")));
await t("HOD cannot read students", false, () => getDoc(doc(hod, "colleges/c1/students/s1")));
await t("student cannot read another student's record", false, () => getDoc(doc(as("stu2", "STUDENT"), "colleges/c1/students/s1")));
await t("other college's HOD cannot read this college", false, () => getDoc(doc(other, "colleges/c1/departments/d1")));
await t("signed-out cannot read anything", false, () => getDoc(doc(env.unauthenticatedContext().firestore(), "colleges/c1/users/hod1")));
await env.cleanup();
console.log(fail ? `${fail} FAILED` : "ALL PASSED");
process.exit(fail ? 1 : 0);
