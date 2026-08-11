export const dynamic = "force-dynamic";

// Fulfills a College Office credential request (see ../request-credentials) by
// actually creating the candidate's Firebase Auth login + faculty record.
// Webmaster-only - Office can request but not provision, per the pipeline's
// step-4 handoff (see AGENTS.md / the hiring pipeline extension plan).

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { provisionFacultyFromOffer } from "@/lib/firestore/facultyProvisioning";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("WEBMASTER", "SUPER_ADMIN");
    const { id } = await params;
    const db = getAdminDb();
    const now = new Date();

    // Only fulfill offers the office has actually requested - closes the
    // step-4 gate server-side, not just via the UI hiding the button.
    const letterRef = db.collection("colleges").doc(session.collegeId).collection("offerLetters").doc(id);
    const letterSnap = await letterRef.get();
    if (!letterSnap.exists) {
      return NextResponse.json({ error: "Offer letter or candidate not found" }, { status: 404 });
    }
    const letter = letterSnap.data() as { credentialsRequestedAt?: unknown };
    if (!letter.credentialsRequestedAt) {
      return NextResponse.json({ error: "No credential request on file for this offer" }, { status: 400 });
    }

    const result = await provisionFacultyFromOffer(db, session.collegeId, id);

    switch (result.status) {
      case "not_found":
        return NextResponse.json({ error: "Offer letter or candidate not found" }, { status: 404 });
      case "no_email":
        return NextResponse.json(
          { error: "Candidate has no email on file, or an account already exists under a different user" },
          { status: 400 }
        );
      case "email_taken":
        return NextResponse.json(
          { error: "That email is already in use by a different account" },
          { status: 409 }
        );
      case "already_exists":
        return NextResponse.json({ ok: true, alreadyExists: true, facultyId: result.facultyId });
      case "created": {
        const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
        const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
        await letterRef.update({ credentialsFulfilledAt: now, credentialsFulfilledBy: session.uid, updatedAt: now });
        await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
          collegeId: session.collegeId,
          action: "CREDENTIAL_REQUEST_FULFILLED",
          performedBy: session.uid,
          performedByName: actorName,
          targetId: id,
          details: { facultyId: result.facultyId, employeeId: result.employeeId },
          timestamp: now,
        });
        return NextResponse.json({
          ok: true,
          facultyId: result.facultyId,
          employeeId: result.employeeId,
          generatedPassword: result.generatedPassword,
        });
      }
    }
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[offer-letters/provision POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
