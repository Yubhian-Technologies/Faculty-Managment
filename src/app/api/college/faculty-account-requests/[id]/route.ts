export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { provisionFacultyFromOffer, generatePassword } from "@/lib/firestore/facultyProvisioning";
import type { FacultyAccountRequestStatus, EmploymentType } from "@/types";

type Action = "START_REVIEW" | "CREATE_CREDENTIALS" | "COMPLETE";

// Explicit allowed-transitions map - a request can only move to the state
// immediately after its current one, mirroring the Indent/Budget modules'
// action-vs-current-status validation.
const TRANSITIONS: Record<Action, { from: FacultyAccountRequestStatus; to: FacultyAccountRequestStatus }> = {
  START_REVIEW: { from: "SUBMITTED", to: "IN_PROGRESS" },
  CREATE_CREDENTIALS: { from: "IN_PROGRESS", to: "CREDENTIALS_CREATED" },
  COMPLETE: { from: "CREDENTIALS_CREATED", to: "COMPLETED" },
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("WEBMASTER", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as { action?: Action; remarks?: string };

    const action = body.action;
    const transition = action ? TRANSITIONS[action] : undefined;
    if (!action || !transition) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const reqRef = collegeRef.collection("facultyAccountRequests").doc(id);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const reqData = reqSnap.data() as {
      status: FacultyAccountRequestStatus;
      history?: unknown[];
      offerId: string;
      officialEmail: string;
      employmentType: EmploymentType;
      specialization?: string;
      qualification?: string;
      candidateName?: string;
      requestedBy?: string;
    };
    if (reqData.status !== transition.from) {
      return NextResponse.json(
        { error: `Cannot ${action} — request is currently ${reqData.status}, expected ${transition.from}` },
        { status: 409 }
      );
    }

    const actorSnap = await collegeRef.collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    const now = new Date();

    const historyEntry = {
      action: transition.to,
      byUid: session.uid,
      byName: actorName,
      byRole: session.role,
      at: now,
      ...(body.remarks?.trim() ? { remarks: body.remarks.trim() } : {}),
    };

    // CREATE_CREDENTIALS actually provisions the Firebase Auth account + faculty
    // record before the status flips, so a failed provision never leaves the
    // request stuck at "IN_PROGRESS -> CREDENTIALS_CREATED" with no faculty behind it.
    let generatedPassword: string | undefined;
    let facultyId: string | undefined;
    let employeeId: string | undefined;
    if (action === "CREATE_CREDENTIALS") {
      const password = generatePassword();
      const result = await provisionFacultyFromOffer(
        db,
        session.collegeId,
        reqData.offerId,
        { collegeEmail: reqData.officialEmail, password },
        { employmentType: reqData.employmentType, specialization: reqData.specialization, qualification: reqData.qualification }
      );
      if (result.status === "not_found") {
        return NextResponse.json({ error: "Offer letter or candidate not found" }, { status: 404 });
      }
      if (result.status === "no_email") {
        return NextResponse.json({ error: "Could not create the account — the official email may already be in use" }, { status: 400 });
      }
      if (result.status === "already_exists") {
        facultyId = result.facultyId;
      } else {
        facultyId = result.facultyId;
        employeeId = result.employeeId;
        generatedPassword = result.generatedPassword;
      }
    }

    await reqRef.update({
      status: transition.to,
      history: [...(reqData.history ?? []), historyEntry],
      ...(facultyId ? { facultyId } : {}),
      updatedAt: now,
    });

    if (action === "COMPLETE" && reqData.requestedBy) {
      await collegeRef.collection("notifications").add({
        collegeId: session.collegeId,
        toUid: reqData.requestedBy,
        type: "FACULTY_ACCOUNT_REQUEST_COMPLETED",
        title: "Faculty Account Created",
        message: `The faculty account for ${reqData.candidateName ?? "the candidate"} has been created.`,
        link: `/college-office/documents`,
        read: false,
        createdAt: now,
      });
    }

    const auditActionMap: Record<Action, string> = {
      START_REVIEW: "FACULTY_ACCOUNT_REQUEST_IN_PROGRESS",
      CREATE_CREDENTIALS: "FACULTY_ACCOUNT_REQUEST_CREDENTIALS_CREATED",
      COMPLETE: "FACULTY_ACCOUNT_REQUEST_COMPLETED",
    };
    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: auditActionMap[action],
      performedBy: session.uid,
      performedByName: actorName,
      targetId: id,
      details: { facultyId },
      timestamp: now,
    });

    return NextResponse.json({ ok: true, facultyId, employeeId, generatedPassword });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[faculty-account-requests/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
