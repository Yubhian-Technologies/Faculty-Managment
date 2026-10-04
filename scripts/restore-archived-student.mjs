/**
 * Puts one archived student back (see src/lib/students/archiveStudent.ts): the
 * record returns to `students` with its department history, the login is
 * re-enabled under its original email, and the roll's global registry entry is
 * claimed again. Refuses if a student with that id already exists or the roll
 * number has since been taken - in this college or any other. DRY RUN by default; --apply writes. The archive copy is kept.
 *
 * Usage:
 *   node scripts/restore-archived-student.mjs --college=<collegeId> --student=<studentId> [--apply]
 */
import { init, parseArgs, writeBackup, banner } from "./lib/scriptKit.mjs";

const { apply, opt } = parseArgs();
const collegeId = opt("college");
const studentId = opt("student");
if (!collegeId || !studentId) {
  console.error("Usage: node scripts/restore-archived-student.mjs --college=<collegeId> --student=<studentId> [--apply]");
  process.exit(1);
}
const { db, auth } = init();
banner(apply);

const collegeRef = db.collection("colleges").doc(collegeId);
const archiveSnap = await collegeRef.collection("archivedStudents").doc(studentId).get();
if (!archiveSnap.exists) {
  console.error("No archived student with that id.");
  process.exit(1);
}
const a = archiveSnap.data();
// eslint-disable-next-line no-unused-vars
const { archivedAt, archivedBy, archivedByName, archiveReason, archiveVersion, departmentHistory, archivedLogin, ...student } = a;

if ((await collegeRef.collection("students").doc(studentId).get()).exists) {
  console.error("A live student already has this id - nothing to restore.");
  process.exit(1);
}
const upper = String(student.rollNumber ?? "").trim().toUpperCase();
const key = String(student.rollNumber ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
if (upper) {
  const clash = await collegeRef.collection("students").where("rollNumberUpper", "==", upper).limit(1).get();
  if (!clash.empty) {
    console.error(`Roll number ${student.rollNumber} is now held by student ${clash.docs[0].id} - resolve that first.`);
    process.exit(1);
  }
}
// Roll numbers are unique across ALL colleges: the global registry must not show the
// roll as held by somebody else now.
const registryRef = key ? db.collection("studentUsernames").doc(key.toUpperCase()) : null;
if (registryRef) {
  const reg = await registryRef.get();
  const r = reg.exists ? reg.data() : null;
  const mine = r && ((r.collegeId === collegeId && r.studentDocId === studentId) || (!r.studentDocId && archivedLogin?.uid && r.uid === archivedLogin.uid));
  if (r && r.active !== false && !mine) {
    console.error(`Roll number ${student.rollNumber} is now registered to another student (${r.collegeId ?? "legacy"}/${r.studentDocId ?? "?"}) - resolve that first.`);
    process.exit(1);
  }
}
console.log(`Restoring ${student.name} (${student.rollNumber}) - department history entries: ${(departmentHistory ?? []).length}; login: ${archivedLogin ? archivedLogin.loginEmail : "none"}`);
if (!apply) {
  console.log("\nDry run complete - nothing written.");
  process.exit(0);
}

console.log(`Backup written: ${writeBackup("restore-archived-student", [{ path: archiveSnap.ref.path, data: a }])}`);
const batch = db.batch();
batch.set(collegeRef.collection("students").doc(studentId), { ...student, updatedAt: new Date(), restoredAt: new Date() });
for (const h of departmentHistory ?? []) {
  const { id, ...data } = h;
  batch.set(collegeRef.collection("students").doc(studentId).collection("departmentHistory").doc(id), data);
}
await batch.commit();

if (archivedLogin?.uid) {
  await auth.updateUser(archivedLogin.uid, { disabled: false, ...(archivedLogin.loginEmail ? { email: archivedLogin.loginEmail } : {}) });
  const userRef = collegeRef.collection("users").doc(archivedLogin.uid);
  if ((await userRef.get()).exists) await userRef.update({ isActive: true, archivedAt: null });
  const names = await db.collection("studentUsernames").where("uid", "==", archivedLogin.uid).get();
  await Promise.all(names.docs.map((d) => d.ref.update({ active: true, archivedAt: null, retiredAt: null })));
}
if (registryRef) {
  // Re-claim the roll globally (without wiping an entry that already carries this login).
  await registryRef.set(
    {
      rollKey: key, rollNumber: String(student.rollNumber).trim(), rollNumberUpper: upper, collegeId, studentDocId: studentId,
      name: student.name ?? "", active: true, retiredAt: null, archivedAt: null,
      ...(archivedLogin?.uid && archivedLogin.loginEmail ? { uid: archivedLogin.uid, loginEmail: archivedLogin.loginEmail } : {}),
    },
    { merge: true }
  );
}
console.log("Restored. (The archive copy was left in place.)");
