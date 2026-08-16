import type { Firestore } from "firebase-admin/firestore";

// Face-registration timestamp for a person, resolved the same way self
// check-in does (see /api/college/attendance/face-registration): Faculty's
// lives on their facultyMembers doc; HOD/Principal/Vice Principal's lives
// directly on their own users/{uid} doc (no FacultyMember record).
export async function resolveFaceRegisteredAt(
  db: Firestore,
  collegeId: string,
  uid: string,
  role: string
): Promise<Date | null> {
  const collegeRef = db.collection("colleges").doc(collegeId);

  if (role === "PANEL_MEMBER") {
    const snap = await collegeRef.collection("facultyMembers").where("userUid", "==", uid).limit(1).get();
    const data = snap.docs[0]?.data() as { faceRegisteredAt?: FirebaseFirestore.Timestamp } | undefined;
    return data?.faceRegisteredAt ? data.faceRegisteredAt.toDate() : null;
  }

  const snap = await collegeRef.collection("users").doc(uid).get();
  const data = snap.data() as { faceRegisteredAt?: FirebaseFirestore.Timestamp } | undefined;
  return data?.faceRegisteredAt ? data.faceRegisteredAt.toDate() : null;
}
