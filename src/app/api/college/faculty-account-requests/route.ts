export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "WEBMASTER", "SUPER_ADMIN", "ACCOUNTS", "COLLEGE_ACCOUNTS");
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("facultyAccountRequests")
      .orderBy("createdAt", "desc")
      .get();

    let requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (status) requests = requests.filter((r) => (r as { status?: string }).status === status);

    return NextResponse.json({ requests });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[faculty-account-requests GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      offerId?: string;
      officialEmail?: string;
      alternateEmail1?: string;
      alternateEmail2?: string;
    };

    const { offerId, officialEmail } = body;
    if (!offerId || !officialEmail?.trim()) {
      return NextResponse.json({ error: "offerId and officialEmail required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const offerSnap = await collegeRef.collection("offerLetters").doc(offerId).get();
    if (!offerSnap.exists) {
      return NextResponse.json({ error: "Offer letter not found" }, { status: 404 });
    }
    const offer = offerSnap.data() as {
      status?: string;
      candidateId?: string;
      candidateName?: string;
      designation?: string;
      department?: string;
      batchId?: string;
      candidateConfirmedJoiningDate?: string;
    };

    // Enforce the required sequence: offer accepted -> appointment letter sent
    // -> candidate confirmed their joining date -> only then can Office request
    // the account. Mirrors the gate the old request-credentials route used.
    if (offer.status !== "ACCEPTED") {
      return NextResponse.json({ error: "Offer must be accepted before requesting a faculty account" }, { status: 400 });
    }
    if (!offer.candidateConfirmedJoiningDate) {
      return NextResponse.json({ error: "Candidate has not confirmed a date of joining yet" }, { status: 400 });
    }
    // Scoped to this offer's batch, not just the candidateId - a candidate
    // re-hired for a second, unrelated role who already has an old appointment
    // letter on file must not incorrectly clear this gate for the new offer.
    const appointmentSnap = await collegeRef
      .collection("appointmentLetters")
      .where("candidateId", "==", offer.candidateId ?? "")
      .get();
    const matchingAppointment = appointmentSnap.docs.find((d) => (d.data() as { batchId?: string }).batchId === offer.batchId);
    if (!matchingAppointment) {
      return NextResponse.json({ error: "Appointment letter must be generated first" }, { status: 400 });
    }

    const existingSnap = await collegeRef.collection("facultyAccountRequests").where("offerId", "==", offerId).limit(1).get();
    if (!existingSnap.empty) {
      return NextResponse.json({ error: "A faculty account request already exists for this offer" }, { status: 409 });
    }

    const candidateSnap = offer.candidateId ? await collegeRef.collection("candidates").doc(offer.candidateId).get() : null;
    const candidate = candidateSnap?.data() as { email?: string; phone?: string } | undefined;

    const actorSnap = await collegeRef.collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    const now = new Date();

    const historyEntry = {
      action: "SUBMITTED",
      byUid: session.uid,
      byName: actorName,
      byRole: session.role,
      at: now,
    };

    const docRef = await collegeRef.collection("facultyAccountRequests").add({
      collegeId: session.collegeId,
      offerId,
      candidateId: offer.candidateId ?? "",
      candidateName: offer.candidateName ?? "",
      candidateEmail: candidate?.email ?? "",
      candidatePhone: candidate?.phone ?? "",
      officialEmail: officialEmail.trim(),
      ...(body.alternateEmail1?.trim() ? { alternateEmail1: body.alternateEmail1.trim() } : {}),
      ...(body.alternateEmail2?.trim() ? { alternateEmail2: body.alternateEmail2.trim() } : {}),
      designation: offer.designation ?? "",
      department: offer.department ?? "",
      status: "SUBMITTED",
      history: [historyEntry],
      requestedBy: session.uid,
      requestedByName: actorName,
      createdAt: now,
      updatedAt: now,
    });

    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "FACULTY_ACCOUNT_REQUEST_SUBMITTED",
      performedBy: session.uid,
      performedByName: actorName,
      targetId: docRef.id,
      details: { candidateId: offer.candidateId, candidateName: offer.candidateName },
      timestamp: now,
    });

    const webmasterSnap = await collegeRef.collection("users").where("role", "==", "WEBMASTER").get();
    const batch = db.batch();
    for (const d of webmasterSnap.docs) {
      const notifRef = collegeRef.collection("notifications").doc();
      batch.set(notifRef, {
        collegeId: session.collegeId,
        toUid: d.id,
        type: "CREDENTIAL_REQUESTED",
        title: "Faculty Account Request",
        message: `${actorName} requested a faculty account for ${offer.candidateName ?? "a candidate"}.`,
        link: `/webmaster/credential-requests`,
        read: false,
        createdAt: now,
      });
    }
    await batch.commit();

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[faculty-account-requests POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
