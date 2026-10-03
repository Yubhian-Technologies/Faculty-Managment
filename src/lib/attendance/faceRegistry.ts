import { EMBEDDING_LENGTH } from "@/lib/attendance/faceThreshold";

// Where a person's registered face descriptor lives: their faculty record, else
// their own user document (HODs, Principal and Vice Principal have no separate
// faculty record, so their registration sits on users/{uid} - naturally a
// separate document from any faculty member's, never shared).
export async function resolveOwnDocRef(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string
): Promise<FirebaseFirestore.DocumentReference> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const facultySnap = await collegeRef.collection("facultyMembers").where("userUid", "==", uid).limit(1).get();
  if (!facultySnap.empty) return facultySnap.docs[0].ref;
  return collegeRef.collection("users").doc(uid);
}

/** The caller's registered descriptor, or null when none (or a malformed one) is on file. */
export async function loadRegisteredEmbedding(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string
): Promise<number[] | null> {
  const ref = await resolveOwnDocRef(db, collegeId, uid);
  const data = (await ref.get()).data() as { faceEmbedding?: number[] } | undefined;
  const embedding = data?.faceEmbedding;
  return Array.isArray(embedding) && embedding.length === EMBEDDING_LENGTH ? embedding : null;
}
