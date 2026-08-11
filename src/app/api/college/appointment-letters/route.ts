export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveOfferLetterCcEmails } from "@/lib/firestore/offerLetterCc";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE", "HOD", "ACCOUNTS");
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId");
    const candidateId = searchParams.get("candidateId");

    const db = getAdminDb();
    let query = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("appointmentLetters") as FirebaseFirestore.Query;

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
    console.error("[appointment-letters GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      candidateId: string;
      batchId: string;
      candidateName: string;
      designation: string;
      department: string;
      joiningDate: string;
      ctcAnnual?: number;
      candidateAddress?: string;
      termsAndConditions?: string;
    };

    const { candidateId, batchId, candidateName, designation, department, joiningDate } = body;
    if (!candidateId || !batchId || !designation || !department || !joiningDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();

    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";

    // Same CC recipients as the offer letter (Principal, VP, panel, HOD, Accounts).
    const { ccEmails } = await resolveOfferLetterCcEmails(db, session.collegeId, batchId);

    const docRef = db.collection("colleges").doc(session.collegeId).collection("appointmentLetters").doc();
    const letter = {
      id: docRef.id,
      collegeId: session.collegeId,
      candidateId,
      candidateName,
      batchId,
      designation,
      department,
      joiningDate: new Date(joiningDate),
      ...(body.ctcAnnual != null ? { ctcAnnual: body.ctcAnnual } : {}),
      ...(body.candidateAddress?.trim() ? { candidateAddress: body.candidateAddress.trim() } : {}),
      ...(body.termsAndConditions?.trim() ? { termsAndConditions: body.termsAndConditions.trim() } : {}),
      status: "SENT",
      generatedBy: actorName,
      generatedByUid: session.uid,
      generatedAt: now,
    };

    await docRef.set(letter);

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "APPOINTMENT_LETTER_GENERATED",
      performedBy: session.uid,
      performedByName: actorName,
      targetId: candidateId,
      details: { candidateName, designation, department, batchId },
      timestamp: now,
    });

    return NextResponse.json({ id: docRef.id, ok: true, ccEmails });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[appointment-letters POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
