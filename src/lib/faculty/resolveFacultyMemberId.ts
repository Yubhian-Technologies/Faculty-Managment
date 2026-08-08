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

// `Section.facultyInchargeUid` is *meant* to hold the login uid (it's read by
// comparing directly against session.uid, unlike facultyId elsewhere) — but
// the HOD "Class Incharge" picker sources its options from
// GET /api/college/faculty (the FacultyMember collection) and some call sites
// have historically stored that record's own id instead of resolving it to
// the linked login uid first. Rather than trust either form, any caller
// checking "am I in charge of this section" should match against both:
// candidate[0] is the login uid (correct form), candidate[1] (if the caller
// has a linked FacultyMember record) is that record's id (the historically
// incorrect but still-present form in some existing data).
export async function getFacultyIdCandidates(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string
): Promise<string[]> {
  const facultyMemberId = await resolveFacultyMemberId(db, collegeId, uid);
  return facultyMemberId === uid ? [uid] : [uid, facultyMemberId];
}

// Reverse of resolveFacultyMemberId: given a FacultyMember doc id (what the
// "Class Incharge" picker actually supplies), resolve it to that faculty's
// linked login uid so writes to facultyInchargeUid store the form reads
// expect. Falls back to the id itself if that faculty has no linked login
// yet (not provisioned) — getFacultyIdCandidates still matches it once they
// have a login registered, since resolveFacultyMemberId is checked at read time.
export async function resolveLoginUidForFacultyMember(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  facultyMemberId: string
): Promise<string> {
  const snap = await db.collection("colleges").doc(collegeId).collection("facultyMembers").doc(facultyMemberId).get();
  const linkedUid = (snap.data() as { userUid?: string } | undefined)?.userUid;
  return linkedUid || facultyMemberId;
}
