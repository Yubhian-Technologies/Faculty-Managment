export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Firestore } from "firebase-admin/firestore";

async function getUserName(db: Firestore, collegeId: string, uid: string): Promise<string> {
  if (!collegeId || !uid) return "Unknown";
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    return (snap.data() as { name?: string } | undefined)?.name ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const { id } = await params;
    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("vacancyRequests")
      .doc(id)
      .get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ vacancyRequest: { id: snap.id, ...snap.data() } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[vacancy-requests/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as {
      status: string;
      reason?: string;
      notes?: string;
    };

    const { status, reason, notes } = body;
    if (!status) {
      return NextResponse.json({ error: "status required" }, { status: 400 });
    }

    const db = getAdminDb();
    const principalName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    const vacancySnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("vacancyRequests")
      .doc(id)
      .get();

    if (!vacancySnap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const vacancy = vacancySnap.data() as { hodUid: string; position: string };

    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("vacancyRequests")
      .doc(id)
      .update({
        status,
        principalResponse: {
          action: status,
          reason: reason ?? "",
          notes: notes ?? "",
          respondedAt: now,
          principalUid: session.uid,
          principalName,
        },
        updatedAt: now,
      });

    const notifType =
      status === "APPROVED" ? "VACANCY_APPROVED" : status === "REJECTED" ? "VACANCY_REJECTED" : "GENERAL";
    const notifTitle =
      status === "APPROVED"
        ? "Vacancy Request Approved"
        : status === "REJECTED"
        ? "Vacancy Request Rejected"
        : "Vacancy Request Modified";
    const notifMessage =
      status === "APPROVED"
        ? `Your vacancy request for ${vacancy.position} has been approved. You may now collect candidates.`
        : status === "REJECTED"
        ? `Your vacancy request for ${vacancy.position} was rejected.${reason ? ` Reason: ${reason}` : ""}`
        : `Your vacancy request for ${vacancy.position} was modified.${notes ? ` Notes: ${notes}` : ""}`;

    if (vacancy.hodUid) {
      await db.collection("colleges").doc(session.collegeId).collection("notifications").add({
        collegeId: session.collegeId,
        toUid: vacancy.hodUid,
        type: notifType,
        title: notifTitle,
        message: notifMessage,
        link: `/hod/vacancy`,
        read: false,
        createdAt: now,
      });
    }

    const auditAction =
      status === "APPROVED"
        ? "VACANCY_REQUEST_APPROVED"
        : "VACANCY_REQUEST_REJECTED";

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: auditAction,
      performedBy: session.uid,
      performedByName: principalName,
      targetId: id,
      details: {
        status,
        ...(reason !== undefined && { reason }),
        ...(notes !== undefined && { notes }),
      },
      timestamp: now,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[vacancy-requests/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const db = getAdminDb();

    const vacancyRef = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("vacancyRequests")
      .doc(id);
    const vacancySnap = await vacancyRef.get();

    if (!vacancySnap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const vacancy = vacancySnap.data() as { hodUid?: string; position?: string };

    if (session.role === "HOD" && vacancy.hodUid !== session.uid) {
      return NextResponse.json({ error: "You can only delete your own hiring requests" }, { status: 403 });
    }

    const [batchSnap, applicationSnap] = await Promise.all([
      db.collection("colleges").doc(session.collegeId).collection("hiringBatches")
        .where("vacancyId", "==", id).limit(1).get(),
      db.collection("colleges").doc(session.collegeId).collection("candidateApplications")
        .where("vacancyRequestId", "==", id).limit(1).get(),
    ]);

    if (!batchSnap.empty) {
      return NextResponse.json(
        { error: "Cannot delete - an interview process has already started for this request." },
        { status: 400 }
      );
    }
    if (!applicationSnap.empty) {
      return NextResponse.json(
        { error: "Cannot delete - candidates have already been attached to this request." },
        { status: 400 }
      );
    }

    await vacancyRef.delete();

    const actorName = await getUserName(db, session.collegeId, session.uid);
    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "VACANCY_REQUEST_DELETED",
      performedBy: session.uid,
      performedByName: actorName,
      targetId: id,
      details: { position: vacancy.position },
      timestamp: new Date(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[vacancy-requests/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
