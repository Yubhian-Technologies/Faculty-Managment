import { isValidDescriptor } from "@/lib/attendance/faceThreshold";

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

/**
 * Every registered sample: `faceEmbeddingSamples` ([{ v: number[] }] - Firestore can't hold nested arrays),
 * else the single `faceEmbedding` saved before samples existed. Empty when nothing usable is on file.
 */
export function registeredSamplesOf(data: { faceEmbedding?: unknown; faceEmbeddingSamples?: unknown } | undefined): number[][] {
  const samples = Array.isArray(data?.faceEmbeddingSamples)
    ? (data!.faceEmbeddingSamples as { v?: unknown }[]).map((x) => x?.v).filter(isValidDescriptor)
    : [];
  if (samples.length) return samples;
  return isValidDescriptor(data?.faceEmbedding) ? [data!.faceEmbedding as number[]] : [];
}

export async function loadRegisteredSamples(db: FirebaseFirestore.Firestore, collegeId: string, uid: string): Promise<number[][]> {
  const ref = await resolveOwnDocRef(db, collegeId, uid);
  return registeredSamplesOf((await ref.get()).data() as { faceEmbedding?: unknown; faceEmbeddingSamples?: unknown } | undefined);
}
