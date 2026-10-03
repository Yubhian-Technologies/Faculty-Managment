/**
 * Puts one archived faculty member back (see src/lib/faculty/archiveFaculty.ts):
 * the record returns to `facultyMembers`, their login profile and role mapping
 * are re-created from the archive, and the Auth user is re-enabled under its
 * original email. Refuses if that id exists or the employee id has since been
 * taken. DRY RUN by default; --apply writes. The archive copy is kept.
 *
 * Usage:
 *   node scripts/restore-archived-faculty.mjs --college=<collegeId> --faculty=<facultyId> [--apply]
 */
import { init, parseArgs, writeBackup, banner } from "./lib/scriptKit.mjs";

const { apply, opt } = parseArgs();
const collegeId = opt("college");
const facultyId = opt("faculty");
if (!collegeId || !facultyId) {
  console.error("Usage: node scripts/restore-archived-faculty.mjs --college=<collegeId> --faculty=<facultyId> [--apply]");
  process.exit(1);
}
const { db, auth } = init();
banner(apply);

const collegeRef = db.collection("colleges").doc(collegeId);
const archiveSnap = await collegeRef.collection("archivedFacultyMembers").doc(facultyId).get();
if (!archiveSnap.exists) {
  console.error("No archived faculty member with that id.");
  process.exit(1);
}
const a = archiveSnap.data();
// eslint-disable-next-line no-unused-vars
const { archivedAt, archivedBy, archivedByName, archiveReason, archiveVersion, archivedLogin, ...faculty } = a;

if ((await collegeRef.collection("facultyMembers").doc(facultyId).get()).exists) {
  console.error("A live faculty member already has this id.");
  process.exit(1);
}
if (faculty.employeeId) {
  const clash = await db.collectionGroup("facultyMembers").where("employeeId", "==", faculty.employeeId).limit(1).get();
  if (!clash.empty) {
    console.error(`Employee ID ${faculty.employeeId} is now held by another faculty member.`);
    process.exit(1);
  }
}
console.log(`Restoring ${faculty.legalName ?? faculty.name} (${faculty.employeeId}); login: ${archivedLogin ? archivedLogin.loginEmail : "none"}`);
if (!apply) {
  console.log("\nDry run complete - nothing written.");
  process.exit(0);
}

console.log(`Backup written: ${writeBackup("restore-archived-faculty", [{ path: archiveSnap.ref.path, data: a }])}`);
const batch = db.batch();
batch.set(collegeRef.collection("facultyMembers").doc(facultyId), { ...faculty, updatedAt: new Date(), restoredAt: new Date() });
if (archivedLogin?.uid) {
  if (archivedLogin.userDoc) batch.set(collegeRef.collection("users").doc(archivedLogin.uid), archivedLogin.userDoc);
  if (archivedLogin.systemUserDoc) batch.set(db.collection("systemUsers").doc(archivedLogin.uid), archivedLogin.systemUserDoc);
}
await batch.commit();
if (archivedLogin?.uid) {
  await auth.updateUser(archivedLogin.uid, { disabled: false, ...(archivedLogin.loginEmail ? { email: archivedLogin.loginEmail } : {}) });
}
console.log("Restored. (The archive copy was left in place.)");
