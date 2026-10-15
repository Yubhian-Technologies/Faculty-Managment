import type { Firestore } from "firebase-admin/firestore";
import type { ResearchPublication } from "@/types";

// R&D owns the official publication record (colleges/{id}/publications) - any
// screen that needs to show someone's publications (Management dashboards,
// resume export, ...) should read from here rather than the legacy
// self-reported academicProfile.publications array.
export async function getPublicationsForUid(db: Firestore, collegeId: string, uid: string): Promise<ResearchPublication[]> {
  // The ones they submitted AND the ones that list them as an internal co-author (internalAuthorUids).
  const coll = db.collection("colleges").doc(collegeId).collection("publications");
  const [own, coAuthored] = await Promise.all([
    coll.where("uid", "==", uid).get(),
    coll.where("internalAuthorUids", "array-contains", uid).get(),
  ]);
  const byId = new Map<string, ResearchPublication>();
  for (const d of own.docs) byId.set(d.id, { id: d.id, ...d.data() } as ResearchPublication);
  // Co-authored ones come in once verified only - these screens show official records, and the
  // co-author's own dashboard already shows a pending one as such.
  for (const d of coAuthored.docs) {
    const status = (d.data() as { status?: string }).status;
    if (!status || status === "APPROVED") byId.set(d.id, { id: d.id, ...d.data() } as ResearchPublication);
  }
  return [...byId.values()]
    .sort((a, b) => (b.publicationYear ?? 0) - (a.publicationYear ?? 0));
}
