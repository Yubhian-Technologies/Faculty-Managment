export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { provisionFacultyFromOffer, generatePassword, type ProvisionResult } from "@/lib/firestore/facultyProvisioning";
import type { FacultyAccountRequestStatus } from "@/types";

type Action = "START_REVIEW" | "CREATE_CREDENTIALS" | "COMPLETE" | "REVEAL_CREDENTIALS";

// Explicit allowed-transitions map - a request can only move to the state
// immediately after its current one, mirroring the Indent/Budget modules'
// action-vs-current-status validation. REVEAL_CREDENTIALS isn't a status
// transition (see the branch below) so it's handled outside this map.
const TRANSITIONS: Record<Exclude<Action, "REVEAL_CREDENTIALS">, { from: FacultyAccountRequestStatus; to: FacultyAccountRequestStatus }> = {
  START_REVIEW: { from: "SUBMITTED", to: "IN_PROGRESS" },
  CREATE_CREDENTIALS: { from: "IN_PROGRESS", to: "CREDENTIALS_CREATED" },
  COMPLETE: { from: "CREDENTIALS_CREATED", to: "COMPLETED" },
};

const MIN_PASSWORD_LENGTH = 6; // Firebase Auth's own minimum

// Tries each provided email in order (recommended, then the two optional
// alternates), stopping at the first one that isn't already taken by a
// different account — this is the "check for the existing ones" step the
// Office/Webmaster handoff relies on instead of Webmaster picking manually.
async function provisionWithFallback(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  offerId: string,
  emails: string[],
  password: string
): Promise<{ result: ProvisionResult; assignedEmail?: string }> {
  let lastResult: ProvisionResult = { status: "no_email" };
  for (const email of emails) {
    const result = await provisionFacultyFromOffer(db, collegeId, offerId, { collegeEmail: email, password });
    if (result.status !== "email_taken") {
      return { result, assignedEmail: result.status === "created" || result.status === "already_exists" ? email : undefined };
    }
    lastResult = result;
  }
  return { result: lastResult };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as { action?: Action; remarks?: string; password?: string };
    const action = body.action;

    const db = getAdminDb();

    if (action === "REVEAL_CREDENTIALS") {
      // Office-side roles only — Webmaster already saw the password once
      // client-side when they created it. Reads and immediately scrubs the
      // password in one transaction so a refresh or a second viewer never
      // sees it again.
      const session = await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
      const reqRef = db.collection("colleges").doc(session.collegeId).collection("facultyAccountRequests").doc(id);
      const revealed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(reqRef);
        if (!snap.exists) return { error: "Not found" as const, code: 404 };
        const data = snap.data() as { assignedEmail?: string; credentialResult?: { password?: string; revealed?: boolean } };
        if (!data.credentialResult || data.credentialResult.revealed || !data.credentialResult.password) {
          return { error: "These credentials have already been revealed" as const, code: 410 };
        }
        tx.update(reqRef, { credentialResult: { revealed: true } });
        return { email: data.assignedEmail ?? "", password: data.credentialResult.password };
      });
      if ("error" in revealed) return NextResponse.json({ error: revealed.error }, { status: revealed.code });
      return NextResponse.json(revealed);
    }

    const session = await requireCollegeMember("WEBMASTER", "SUPER_ADMIN");

    const transition = action ? TRANSITIONS[action as Exclude<Action, "REVEAL_CREDENTIALS">] : undefined;
    if (!action || !transition) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

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
      alternateEmail1?: string;
      alternateEmail2?: string;
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
    let assignedEmail: string | undefined;
    if (action === "CREATE_CREDENTIALS") {
      // Webmaster sets the password directly rather than always generating one -
      // still validated against Firebase Auth's own minimum length.
      if (body.password !== undefined && body.password.trim().length < MIN_PASSWORD_LENGTH) {
        return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, { status: 400 });
      }
      const password = body.password?.trim() || generatePassword();
      const candidateEmails = [reqData.officialEmail, reqData.alternateEmail1, reqData.alternateEmail2].filter(
        (e): e is string => !!e?.trim()
      );
      const { result, assignedEmail: winningEmail } = await provisionWithFallback(
        db,
        session.collegeId,
        reqData.offerId,
        candidateEmails,
        password
      );
      if (result.status === "not_found") {
        return NextResponse.json({ error: "Offer letter or candidate not found" }, { status: 404 });
      }
      if (result.status === "no_email") {
        return NextResponse.json({ error: "Could not create the account — no email was provided" }, { status: 400 });
      }
      if (result.status === "email_taken") {
        return NextResponse.json(
          { error: "All provided emails are already in use — resubmit the request with different alternates" },
          { status: 409 }
        );
      }
      assignedEmail = winningEmail;
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
      ...(assignedEmail ? { assignedEmail } : {}),
      ...(generatedPassword ? { credentialResult: { password: generatedPassword, revealed: false } } : {}),
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

    const auditActionMap: Record<Exclude<Action, "REVEAL_CREDENTIALS">, string> = {
      START_REVIEW: "FACULTY_ACCOUNT_REQUEST_IN_PROGRESS",
      CREATE_CREDENTIALS: "FACULTY_ACCOUNT_REQUEST_CREDENTIALS_CREATED",
      COMPLETE: "FACULTY_ACCOUNT_REQUEST_COMPLETED",
    };
    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: auditActionMap[action as Exclude<Action, "REVEAL_CREDENTIALS">],
      performedBy: session.uid,
      performedByName: actorName,
      targetId: id,
      details: { facultyId, assignedEmail },
      timestamp: now,
    });

    return NextResponse.json({ ok: true, facultyId, employeeId, generatedPassword, assignedEmail });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[faculty-account-requests/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
