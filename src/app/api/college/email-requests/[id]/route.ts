export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";

const ALL_ROLES = ["WEBMASTER", "COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"];

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember(...ALL_ROLES);
    const { id } = await params;
    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("emailRequests").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ request: { id: snap.id, ...snap.data() } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/email-requests/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember(...ALL_ROLES);
    const { id } = await params;
    const body = (await request.json()) as {
      action?: "FULFILL" | "CANCEL";
      assignedEmail?: string;
      webmasterNotes?: string;
      reason?: string;
    };

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("emailRequests").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const reqData = snap.data() as {
      status?: string;
      facultyId?: string;
      candidateName?: string;
      requestedByUid?: string;
    };
    const now = new Date();

    if (body.action === "FULFILL") {
      if (session.role !== "WEBMASTER" && session.role !== "SUPER_ADMIN") {
        return NextResponse.json({ error: "Only the Webmaster can create the official email" }, { status: 403 });
      }
      if (reqData.status !== "PENDING") {
        return NextResponse.json({ error: "This request has already been resolved" }, { status: 400 });
      }
      const assignedEmail = body.assignedEmail?.trim().toLowerCase();
      if (!assignedEmail || !isValidEmail(assignedEmail)) {
        return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
      }

      // Re-check uniqueness at the moment of creation (defense-in-depth —
      // the UI already calls check-availability, but state may have moved on).
      const [facultyByOfficial, facultyByLogin, userDupe, requestDupe] = await Promise.all([
        db.collection("colleges").doc(session.collegeId).collection("facultyMembers").where("officialEmail", "==", assignedEmail).limit(1).get(),
        db.collection("colleges").doc(session.collegeId).collection("facultyMembers").where("collegeEmail", "==", assignedEmail).limit(1).get(),
        db.collection("colleges").doc(session.collegeId).collection("users").where("email", "==", assignedEmail).limit(1).get(),
        db.collection("colleges").doc(session.collegeId).collection("emailRequests").where("assignedEmail", "==", assignedEmail).limit(1).get(),
      ]);
      if (!facultyByOfficial.empty || !facultyByLogin.empty || !userDupe.empty || !requestDupe.empty) {
        return NextResponse.json({ error: "This email address is already in use" }, { status: 409 });
      }

      const webmasterSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      const webmasterName = (webmasterSnap.data() as { name?: string } | undefined)?.name ?? session.email ?? "Webmaster";

      await ref.update({
        status: "COMPLETED",
        assignedEmail,
        webmasterNotes: body.webmasterNotes?.trim() || null,
        fulfilledByUid: session.uid,
        fulfilledByName: webmasterName,
        fulfilledAt: now,
        updatedAt: now,
      });

      if (reqData.facultyId) {
        await db.collection("colleges").doc(session.collegeId).collection("facultyMembers").doc(reqData.facultyId)
          .update({ officialEmail: assignedEmail, updatedAt: now });
      }

      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "EMAIL_REQUEST_FULFILLED",
        performedBy: session.uid,
        performedByName: webmasterName,
        targetId: id,
        details: { facultyId: reqData.facultyId, assignedEmail },
        timestamp: now,
      });

      if (reqData.requestedByUid) {
        await notify(
          db,
          session.collegeId,
          reqData.requestedByUid,
          "OFFICIAL_EMAIL_CREATED",
          "Official email created",
          `${webmasterName} created the official email for ${reqData.candidateName ?? "your candidate"}: ${assignedEmail}`,
          "/college-office/documents"
        );
      }

      return NextResponse.json({ ok: true, assignedEmail });
    }

    if (body.action === "CANCEL") {
      if (reqData.status !== "PENDING") {
        return NextResponse.json({ error: "Only a pending request can be cancelled" }, { status: 400 });
      }
      if (session.role === "WEBMASTER") {
        // Webmaster does not raise or own requests — cancellation is the requester's call.
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      await ref.update({
        status: "CANCELLED",
        cancelledReason: body.reason?.trim() || null,
        updatedAt: now,
      });

      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "EMAIL_REQUEST_CANCELLED",
        performedBy: session.uid,
        performedByName: session.email ?? "Unknown",
        targetId: id,
        details: { facultyId: reqData.facultyId },
        timestamp: now,
      });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/email-requests/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
