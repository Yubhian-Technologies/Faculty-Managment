export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notifyRole } from "@/lib/notify";

const REQUESTER_ROLES = ["COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"];
// WEBMASTER can view (to fulfill requests) but not raise its own — creation stays
// office-only, matching "the College Office sends a request to the Webmaster".
const VIEW_ROLES = [...REQUESTER_ROLES, "WEBMASTER"];

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...VIEW_ROLES);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const db = getAdminDb();
    let query: FirebaseFirestore.Query = db.collection("colleges").doc(session.collegeId).collection("emailRequests");
    if (status) query = query.where("status", "==", status);
    const snap = await query.orderBy("requestedAt", "desc").get();

    const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ requests });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/email-requests GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...REQUESTER_ROLES);
    const body = (await request.json()) as {
      facultyId?: string;
      preferredEmail1?: string;
      preferredEmail2?: string;
    };
    if (!body.facultyId) {
      return NextResponse.json({ error: "facultyId is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const facultyRef = db.collection("colleges").doc(session.collegeId).collection("facultyMembers").doc(body.facultyId);
    const facultySnap = await facultyRef.get();
    if (!facultySnap.exists) {
      return NextResponse.json({ error: "Faculty record not found" }, { status: 404 });
    }
    const faculty = facultySnap.data() as {
      name?: string;
      candidateId?: string;
      designation?: string;
      department?: string;
      joiningDate?: unknown;
      email?: string;
      phone?: string;
      officialEmail?: string;
    };

    if (faculty.officialEmail) {
      return NextResponse.json({ error: "This faculty member already has an official email assigned" }, { status: 400 });
    }

    const existingSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("emailRequests")
      .where("facultyId", "==", body.facultyId)
      .where("status", "==", "PENDING")
      .limit(1)
      .get();
    if (!existingSnap.empty) {
      return NextResponse.json({ error: "An email request for this faculty member is already in progress" }, { status: 400 });
    }

    const requesterSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const requesterName = (requesterSnap.data() as { name?: string } | undefined)?.name ?? session.email ?? "Unknown";

    const now = new Date();
    const ref = db.collection("colleges").doc(session.collegeId).collection("emailRequests").doc();
    await ref.set({
      collegeId: session.collegeId,
      facultyId: body.facultyId,
      candidateId: faculty.candidateId ?? null,
      candidateName: faculty.name ?? "",
      designation: faculty.designation ?? "",
      department: faculty.department ?? "",
      joiningDate: faculty.joiningDate ?? now,
      personalEmail: faculty.email ?? "",
      phone: faculty.phone ?? "",
      preferredEmail1: body.preferredEmail1?.trim() || null,
      preferredEmail2: body.preferredEmail2?.trim() || null,
      status: "PENDING",
      requestedByUid: session.uid,
      requestedByName: requesterName,
      requestedAt: now,
      updatedAt: now,
    });

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "EMAIL_REQUEST_CREATED",
      performedBy: session.uid,
      performedByName: requesterName,
      targetId: ref.id,
      details: { facultyId: body.facultyId, candidateName: faculty.name ?? "" },
      timestamp: now,
    });

    await notifyRole(
      db,
      session.collegeId,
      "WEBMASTER",
      "EMAIL_REQUEST_SUBMITTED",
      "New official email request",
      `${requesterName} requested an official email for ${faculty.name ?? "a new faculty member"}.`,
      "/webmaster"
    );

    return NextResponse.json({ ok: true, id: ref.id });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/email-requests POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
