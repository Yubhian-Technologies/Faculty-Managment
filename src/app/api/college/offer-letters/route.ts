export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveOfferLetterCcEmails } from "@/lib/firestore/offerLetterCc";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE", "WEBMASTER", "HOD", "ACCOUNTS", "COLLEGE_ACCOUNTS");
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId");
    const candidateId = searchParams.get("candidateId");

    const db = getAdminDb();
    let query = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("offerLetters") as FirebaseFirestore.Query;

    if (batchId) query = query.where("batchId", "==", batchId);
    if (candidateId) query = query.where("candidateId", "==", candidateId);

    const snap = await query.get();
    const letters = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = (a as { generatedAt?: { toMillis?: () => number } }).generatedAt?.toMillis?.() ?? 0;
        const tb = (b as { generatedAt?: { toMillis?: () => number } }).generatedAt?.toMillis?.() ?? 0;
        return tb - ta;
      });

    return NextResponse.json({ letters });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[offer-letters GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACCOUNTS");
    const body = (await request.json()) as {
      candidateId: string;
      batchId: string;
      candidateName: string;
      designation: string;
      department: string;
      joiningDate: string;
      ctcAnnual: number;
      subjects?: string[];
      termsAndConditions?: string;
    };

    const { candidateId, batchId, candidateName, designation, department, joiningDate, ctcAnnual } = body;
    if (!candidateId || !batchId || !designation || !department || !joiningDate || !ctcAnnual) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();

    // An offer can only be sent once the candidate has submitted their bio-data
    // form (mirrors the UI gate on the documents candidate page / offer form).
    const candidateSnap = await db.collection("colleges").doc(session.collegeId).collection("candidates").doc(candidateId).get();
    if (!candidateSnap.exists) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }
    if (!(candidateSnap.data() as { bioDataSubmitted?: boolean }).bioDataSubmitted) {
      return NextResponse.json({ error: "Candidate has not submitted their bio-data form yet" }, { status: 409 });
    }

    // Fetch actor name
    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";

    const { ccEmails: uniqueCcEmails, hodUid, position } = await resolveOfferLetterCcEmails(db, session.collegeId, batchId);

    // Snapshot the Principal-selected terms (see /principal/negotiate) for the
    // candidate acceptance form - a snapshot, not a live reference, so it never
    // changes after the offer is sent even if the application record is edited later.
    // Filters batchId in-memory (matching the GET /candidate-applications route's
    // convention) rather than a second .where(), to avoid needing a new composite index.
    const applicationSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("candidateApplications")
      .where("candidateId", "==", candidateId)
      .get();
    const matchingApplication = applicationSnap.docs.find((d) => (d.data() as { batchId?: string }).batchId === batchId);
    const offeredTerms = (matchingApplication?.data() as { termsAndConditions?: string[] } | undefined)?.termsAndConditions ?? [];

    const docRef = db.collection("colleges").doc(session.collegeId).collection("offerLetters").doc();
    const letter = {
      id: docRef.id,
      collegeId: session.collegeId,
      candidateId,
      batchId,
      candidateName,
      designation,
      department,
      joiningDate: new Date(joiningDate),
      ctcAnnual,
      subjects: body.subjects ?? [],
      ...(body.termsAndConditions?.trim() ? { termsAndConditions: body.termsAndConditions.trim() } : {}),
      offeredTerms,
      // No separate draft/review step - HOD sends the offer in the same action.
      status: "SENT",
      generatedBy: actorName,
      generatedByUid: session.uid,
      generatedAt: now,
      createdAt: now,
      updatedAt: now,
      // Persisted (not just returned) so later actions - e.g. Compose Email on the
      // Offer Letters list - can CC the same people without recomputing this lookup.
      ccEmails: uniqueCcEmails,
    };

    await docRef.set(letter);

    // Faculty account creation is deferred until the offer is accepted — see
    // "Create Faculty Account" on the Offer Letters list.

    // Notify candidate's HOD (the office is sending on the HOD's behalf)
    if (hodUid && hodUid !== session.uid) {
      const notifRef = db.collection("colleges").doc(session.collegeId).collection("notifications").doc();
      await notifRef.set({
        collegeId: session.collegeId,
        toUid: hodUid,
        type: "OFFER_LETTER_GENERATED",
        title: "Offer Letter Sent",
        message: `An offer letter has been sent to ${candidateName} (${position ?? designation}).`,
        link: `/hod/batches/${batchId}`,
        read: false,
        createdAt: now,
      });
    }

    return NextResponse.json({ id: docRef.id, ok: true, ccEmails: uniqueCcEmails });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[offer-letters POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
