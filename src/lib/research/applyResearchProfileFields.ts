import type { Firestore } from "firebase-admin/firestore";

export interface ResearchProfileFieldValues {
  orcidId?: string;
  scopusAuthorId?: string;
  researcherId?: string;
  googleScholarId?: string;
  irinsProfile?: string;
}

// Copies an approved research-profile submission onto the person's actual
// academicProfile - mirrors /api/college/faculty/me GET's dual lookup
// (PANEL_MEMBER has a separate facultyMembers record; HOD/Principal/VP and
// the internal-office roles keep academicProfile directly on their own
// users/{uid} doc).
export async function applyResearchProfileFields(
  db: Firestore,
  collegeId: string,
  uid: string,
  fields: ResearchProfileFieldValues
): Promise<void> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const updates: Record<string, unknown> = {
    "academicProfile.orcidId": fields.orcidId ?? "",
    "academicProfile.scopusAuthorId": fields.scopusAuthorId ?? "",
    "academicProfile.researcherId": fields.researcherId ?? "",
    "academicProfile.googleScholarId": fields.googleScholarId ?? "",
    "academicProfile.irinsProfile": fields.irinsProfile ?? "",
    updatedAt: new Date(),
  };

  const facultySnap = await collegeRef.collection("facultyMembers").where("userUid", "==", uid).limit(1).get();
  if (!facultySnap.empty) {
    await facultySnap.docs[0].ref.update(updates);
    return;
  }
  await collegeRef.collection("users").doc(uid).update(updates);
}
