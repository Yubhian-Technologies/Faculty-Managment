// Shared by the staff "Mark Accepted/Rejected" override (offer-letters/[id]
// PATCH) and the candidate's own public acceptance form (public/offer-acceptance
// POST) - both routes must go through this so a candidate's submission and a
// staff override can never race into a double-write (e.g. Office marks
// REJECTED right as the candidate's already-open tab submits ACCEPTED). The
// transaction only ever applies the decision once, from the SENT state.

export type OfferDecisionResult = "applied" | "not_found" | "already_responded";

export async function applyOfferDecision(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  offerId: string,
  params: {
    decision: "ACCEPTED" | "REJECTED";
    respondedBy: "CANDIDATE" | string;
    termsAccepted?: boolean;
    confirmedDateOfJoining?: string;
  }
): Promise<OfferDecisionResult> {
  const now = new Date();
  const collegeRef = db.collection("colleges").doc(collegeId);
  const letterRef = collegeRef.collection("offerLetters").doc(offerId);

  return db.runTransaction(async (tx): Promise<OfferDecisionResult> => {
    const letterSnap = await tx.get(letterRef);
    if (!letterSnap.exists) return "not_found";

    const letter = letterSnap.data() as { status?: string; candidateId?: string };
    if (letter.status !== "SENT") return "already_responded";

    // All reads must happen before any writes in a transaction - resolve the
    // faculty doc (if any) now, apply it in the write phase below.
    let facultyRef: FirebaseFirestore.DocumentReference | null = null;
    if (params.decision === "ACCEPTED" && letter.candidateId) {
      const facultySnap = await tx.get(
        collegeRef.collection("facultyMembers").where("candidateId", "==", letter.candidateId).limit(1)
      );
      if (!facultySnap.empty) facultyRef = facultySnap.docs[0].ref;
    }

    const updates: Record<string, unknown> = {
      status: params.decision,
      respondedAt: now,
      respondedBy: params.respondedBy,
      updatedAt: now,
    };
    if (params.termsAccepted) updates.termsAcceptedAt = now;
    if (params.confirmedDateOfJoining) updates.candidateConfirmedJoiningDate = params.confirmedDateOfJoining;
    tx.update(letterRef, updates);

    // Candidate formally accepted -> mark them APPROVED and flip the faculty
    // record (provisioned as INTERVIEW_DONE when the offer was sent) to ACTIVE.
    if (params.decision === "ACCEPTED" && letter.candidateId) {
      tx.update(collegeRef.collection("candidates").doc(letter.candidateId), { status: "APPROVED", updatedAt: now });
      if (facultyRef) tx.update(facultyRef, { status: "ACTIVE", updatedAt: now });
    }

    return "applied";
  });
}
