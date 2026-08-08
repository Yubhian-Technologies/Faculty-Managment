export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Office-side "please create this candidate's login" request - does NOT
// provision anything itself. The Webmaster fulfills it from their own queue
// (see /webmaster/credential-requests + the repurposed .../provision route).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const db = getAdminDb();
    const now = new Date();

    const letterRef = db.collection("colleges").doc(session.collegeId).collection("offerLetters").doc(id);
    const letterSnap = await letterRef.get();
    if (!letterSnap.exists) {
      return NextResponse.json({ error: "Offer letter not found" }, { status: 404 });
    }
    const letter = letterSnap.data() as { candidateId?: string; candidateName?: string; credentialsRequestedAt?: unknown };
    if (letter.credentialsRequestedAt) {
      return NextResponse.json({ error: "Credentials already requested for this offer" }, { status: 400 });
    }

    // Gate: an appointment letter must exist before credentials can be requested.
    const appointmentSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("appointmentLetters")
      .where("candidateId", "==", letter.candidateId ?? "")
      .limit(1)
      .get();
    if (appointmentSnap.empty) {
      return NextResponse.json({ error: "Appointment letter must be generated first" }, { status: 400 });
    }

    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";

    await letterRef.update({
      credentialsRequestedAt: now,
      credentialsRequestedBy: session.uid,
      credentialsRequestedByName: actorName,
      updatedAt: now,
    });

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "CREDENTIAL_REQUESTED",
      performedBy: session.uid,
      performedByName: actorName,
      targetId: id,
      details: { candidateId: letter.candidateId, candidateName: letter.candidateName },
      timestamp: now,
    });

    const webmasterSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("users")
      .where("role", "==", "WEBMASTER")
      .get();
    for (const d of webmasterSnap.docs) {
      const notifRef = db.collection("colleges").doc(session.collegeId).collection("notifications").doc();
      await notifRef.set({
        collegeId: session.collegeId,
        toUid: d.id,
        type: "CREDENTIAL_REQUESTED",
        title: "Credential Request",
        message: `${actorName} requested login credentials for ${letter.candidateName ?? "a candidate"}.`,
        link: `/webmaster/credential-requests`,
        read: false,
        createdAt: now,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[offer-letters/[id]/request-credentials POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
