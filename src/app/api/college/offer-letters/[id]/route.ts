export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveOfferLetterCcEmails } from "@/lib/firestore/offerLetterCc";
import { applyOfferDecision } from "@/lib/firestore/offerLetterDecision";

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
      confirmedDateOfJoining?: string;
    };

    const db = getAdminDb();

    // ACCEPTED/REJECTED is a terminal decision the candidate may also submit
    // themselves via the public acceptance form - route both through the same
    // transactional helper so a staff override can never race a candidate
    // submission into a double-write. This button is now a manual override
    // for phone/paper confirmations, not a separate code path. confirmedDateOfJoining
    // must come from this override too - without it, a phone-accepted candidate
    // would never satisfy the faculty-account-request gate that requires it.
    if (body.status === "ACCEPTED" || body.status === "REJECTED") {
      const result = await applyOfferDecision(db, session.collegeId, id, {
        decision: body.status,
        respondedBy: session.uid,
        confirmedDateOfJoining: body.status === "ACCEPTED" ? body.confirmedDateOfJoining : undefined,
      });
      if (result === "not_found") {
        return NextResponse.json({ error: "Offer letter not found" }, { status: 404 });
      }
      if (result === "already_responded") {
        return NextResponse.json({ error: "This offer has already been responded to" }, { status: 409 });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.status) {
      await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("offerLetters")
        .doc(id)
        .update({ status: body.status, updatedAt: new Date() });
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
