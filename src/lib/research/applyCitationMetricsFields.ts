import type { Firestore } from "firebase-admin/firestore";

export interface CitationMetricsFieldValues {
  totalCitations?: number;
  hIndex?: number;
  citationsExcludingSelf?: number;
  hIndexExcludingSelf?: number;
}

// Copies an approved citation-metrics submission onto the person's actual
// academicProfile, under the citations* prefix (kept distinct from the
// legacy totalCitations/hIndex fields - see FacultyProfileFields) - same
// dual lookup as applyResearchProfileFields (PANEL_MEMBER has a separate
// facultyMembers record; everyone else keeps academicProfile on their own
// users/{uid} doc).
export async function applyCitationMetricsFields(
  db: Firestore,
  collegeId: string,
  uid: string,
  fields: CitationMetricsFieldValues
): Promise<void> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const updates: Record<string, unknown> = {
    "academicProfile.citationsTotal": fields.totalCitations ?? 0,
    "academicProfile.citationsHIndex": fields.hIndex ?? 0,
    "academicProfile.citationsExcludingSelf": fields.citationsExcludingSelf ?? 0,
    "academicProfile.citationsHIndexExcludingSelf": fields.hIndexExcludingSelf ?? 0,
    updatedAt: new Date(),
  };

  const facultySnap = await collegeRef.collection("facultyMembers").where("userUid", "==", uid).limit(1).get();
  if (!facultySnap.empty) {
    await facultySnap.docs[0].ref.update(updates);
    return;
  }
  await collegeRef.collection("users").doc(uid).update(updates);
}
