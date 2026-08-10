import type { Firestore } from "firebase-admin/firestore";
import type { ResearchPublication } from "@/types";

// R&D owns the official publication record (colleges/{id}/publications) - any
// screen that needs to show someone's publications (Management dashboards,
// resume export, ...) should read from here rather than the legacy
// self-reported academicProfile.publications array.
export async function getPublicationsForUid(db: Firestore, collegeId: string, uid: string): Promise<ResearchPublication[]> {
  const snap = await db.collection("colleges").doc(collegeId).collection("publications").where("uid", "==", uid).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as ResearchPublication))
    .sort((a, b) => (b.publicationYear ?? 0) - (a.publicationYear ?? 0));
}
