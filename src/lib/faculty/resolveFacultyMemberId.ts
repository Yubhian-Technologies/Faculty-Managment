// Login accounts (colleges/{id}/users/{uid}, keyed by the Firebase Auth uid)
// and HR faculty records (colleges/{id}/facultyMembers/{facultyId}, its own
// auto-generated id) are separate docs, linked one-way via
// facultyMembers.userUid — see GET /api/college/faculty/me. Anything keyed
// off "facultyId" (teachingAssignments, timetableSlots, internalMarks) means
// the FacultyMember doc id, never the login uid, so any caller resolving
// "my own" records must look this up first instead of using session.uid directly.
export async function resolveFacultyMemberId(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string
): Promise<string> {
  const snap = await db
    .collection("colleges")
    .doc(collegeId)
    .collection("facultyMembers")
    .where("userUid", "==", uid)
    .limit(1)
    .get();
  // No linked FacultyMember record (e.g. an HOD/Principal who was never
  // provisioned through the Faculty Register) — fall back to the uid itself
  // so a subsequent facultyId match just resolves to "no results".
  return snap.empty ? uid : snap.docs[0].id;
}
