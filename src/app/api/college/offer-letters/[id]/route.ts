export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveOfferLetterCcEmails } from "@/lib/firestore/offerLetterCc";

// Recomputes the CC list live rather than trusting the value stored at send
// time - covers letters sent before ccEmails was persisted at all, and stays
// correct if the panel/HOD/Principal roster changed since.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "WEBMASTER");
    const { id } = await params;
    const db = getAdminDb();

    const letterSnap = await db.collection("colleges").doc(session.collegeId).collection("offerLetters").doc(id).get();
    if (!letterSnap.exists) {
      return NextResponse.json({ error: "Offer letter not found" }, { status: 404 });
    }
    const batchId = (letterSnap.data() as { batchId?: string }).batchId ?? "";
    const { ccEmails } = await resolveOfferLetterCcEmails(db, session.collegeId, batchId);

    return NextResponse.json({ ccEmails });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[offer-letters/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as {
      status?: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED";
    };

    const db = getAdminDb();
    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (body.status) updates.status = body.status;

    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("offerLetters")
      .doc(id)
      .update(updates);

    // When candidate formally accepts, mark them APPROVED and flip the faculty
    // record (provisioned as INTERVIEW_DONE when the offer was sent) to ACTIVE -
    // they've now actually confirmed and are expected to join on the date already
    // recorded on that record.
    if (body.status === "ACCEPTED") {
      const letterSnap = await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("offerLetters")
        .doc(id)
        .get();
      const candidateId = (letterSnap.data() as { candidateId?: string }).candidateId;
      if (candidateId) {
        await db
          .collection("colleges")
          .doc(session.collegeId)
          .collection("candidates")
          .doc(candidateId)
          .update({ status: "APPROVED", updatedAt: now });

        const facultySnap = await db
          .collection("colleges")
          .doc(session.collegeId)
          .collection("facultyMembers")
          .where("candidateId", "==", candidateId)
          .limit(1)
          .get();
        if (!facultySnap.empty) {
          await facultySnap.docs[0].ref.update({ status: "ACTIVE", updatedAt: now });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[offer-letters/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const db = getAdminDb();

    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("offerLetters")
      .doc(id)
      .delete();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[offer-letters/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
