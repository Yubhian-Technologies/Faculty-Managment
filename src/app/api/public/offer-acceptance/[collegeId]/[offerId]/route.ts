export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { applyOfferDecision } from "@/lib/firestore/offerLetterDecision";
import type { OfferLetter } from "@/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collegeId: string; offerId: string }> }
) {
  try {
    const { collegeId, offerId } = await params;
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(collegeId);

    const [letterSnap, infoSnap] = await Promise.all([
      collegeRef.collection("offerLetters").doc(offerId).get(),
      collegeRef.get(),
    ]);
    if (!letterSnap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const letter = letterSnap.data() as OfferLetter;
    const collegeName = (infoSnap.data() as { name?: string } | undefined)?.name ?? "";

    return NextResponse.json({
      offer: {
        candidateName: letter.candidateName ?? "",
        designation: letter.designation,
        department: letter.department,
        joiningDate: letter.joiningDate,
        ctcAnnual: letter.ctcAnnual,
        offeredTerms: letter.offeredTerms ?? [],
        collegeName,
        status: letter.status,
        alreadyResponded: letter.status !== "SENT",
      },
    });
  } catch (err) {
    console.error("[public/offer-acceptance GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ collegeId: string; offerId: string }> }
) {
  try {
    const { collegeId, offerId } = await params;
    const body = (await request.json()) as {
      termsAccepted?: boolean;
      decision?: "ACCEPTED" | "REJECTED";
      confirmedDateOfJoining?: string;
    };

    if (body.decision !== "ACCEPTED" && body.decision !== "REJECTED") {
      return NextResponse.json({ error: "decision must be ACCEPTED or REJECTED" }, { status: 400 });
    }
    if (body.decision === "ACCEPTED" && !body.termsAccepted) {
      return NextResponse.json({ error: "Terms & Conditions must be accepted before accepting the offer" }, { status: 400 });
    }

    const db = getAdminDb();
    const result = await applyOfferDecision(db, collegeId, offerId, {
      decision: body.decision,
      respondedBy: "CANDIDATE",
      termsAccepted: body.termsAccepted,
      confirmedDateOfJoining: body.confirmedDateOfJoining,
    });

    if (result === "not_found") {
      return NextResponse.json({ error: "Offer letter not found" }, { status: 404 });
    }
    if (result === "already_responded") {
      return NextResponse.json({ error: "This offer has already been responded to" }, { status: 409 });
    }

    const collegeRef = db.collection("colleges").doc(collegeId);
    const letterSnap = await collegeRef.collection("offerLetters").doc(offerId).get();
    const letter = letterSnap.data() as OfferLetter;
    const now = new Date();

    await collegeRef.collection("auditLogs").add({
      collegeId,
      action: body.decision === "ACCEPTED" ? "OFFER_ACCEPTED_BY_CANDIDATE" : "OFFER_REJECTED_BY_CANDIDATE",
      performedBy: "CANDIDATE",
      performedByName: letter.candidateName ?? "Candidate",
      targetId: offerId,
      details: { candidateId: letter.candidateId, confirmedDateOfJoining: body.confirmedDateOfJoining },
      timestamp: now,
    });

    // Notify the office + HOD so the response is visible without them having
    // to poll the offers list.
    const officeSnap = await collegeRef.collection("users").where("role", "in", ["COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL"]).get();
    const batch = db.batch();
    for (const d of officeSnap.docs) {
      const notifRef = collegeRef.collection("notifications").doc();
      batch.set(notifRef, {
        collegeId,
        toUid: d.id,
        type: "OFFER_RESPONSE_RECEIVED",
        title: body.decision === "ACCEPTED" ? "Offer Accepted" : "Offer Rejected",
        message: `${letter.candidateName ?? "The candidate"} has ${body.decision === "ACCEPTED" ? "accepted" : "rejected"} the offer for ${letter.designation}.`,
        link: `/college-office/documents`,
        read: false,
        createdAt: now,
      });
    }
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[public/offer-acceptance POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
