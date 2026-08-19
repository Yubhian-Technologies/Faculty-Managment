export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { provisionFacultyFromOffer, linkFacultyToExistingAccount, generatePassword, type ProvisionResult } from "@/lib/firestore/facultyProvisioning";
import { notify, notifyRole } from "@/lib/notify";
import type { FacultyAccountRequestStatus } from "@/types";

type Action = "START_REVIEW" | "CREATE_CREDENTIALS" | "LINK_EXISTING_ACCOUNT" | "REVEAL_CREDENTIALS";

// Explicit allowed-transitions map - a request can only move to the state
// immediately after its current one, mirroring the Indent/Budget modules'
// action-vs-current-status validation. REVEAL_CREDENTIALS isn't a status
// transition (see the branch below) so it's handled outside this map.
// CREATE_CREDENTIALS/LINK_EXISTING_ACCOUNT accept either SUBMITTED or
// IN_PROGRESS as their starting state - Webmaster can act directly on a fresh
// SUBMITTED request in one click, without a separate Start Review step first.
// Skipping it does not add an IN_PROGRESS entry to history - only actions
// Webmaster actually took are recorded. Both land straight on COMPLETED -
// once the login exists, the request needs no further Webmaster action, so
// there's no separate "mark completed" step for Office to wait on.
const TRANSITIONS: Record<Exclude<Action, "REVEAL_CREDENTIALS">, { from: FacultyAccountRequestStatus[]; to: FacultyAccountRequestStatus }> = {
  START_REVIEW: { from: ["SUBMITTED"], to: "IN_PROGRESS" },
  CREATE_CREDENTIALS: { from: ["SUBMITTED", "IN_PROGRESS"], to: "COMPLETED" },
  LINK_EXISTING_ACCOUNT: { from: ["SUBMITTED", "IN_PROGRESS"], to: "COMPLETED" },
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
    const body = (await request.json()) as { action?: Action; remarks?: string; password?: string; existingUid?: string };
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
      designation?: string;
      department?: string;
      requestedBy?: string;
    };
    if (!transition.from.includes(reqData.status)) {
      return NextResponse.json(
        { error: `Cannot ${action} — request is currently ${reqData.status}, expected ${transition.from.join(" or ")}` },
        { status: 409 }
      );
    }

    const actorSnap = await collegeRef.collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    const now = new Date();

    const newHistoryEntries = [
      {
        action: transition.to,
        byUid: session.uid,
        byName: actorName,
        byRole: session.role,
        at: now,
        ...(body.remarks?.trim() ? { remarks: body.remarks.trim() } : {}),
      },
    ];

    // CREATE_CREDENTIALS actually provisions the Firebase Auth account + faculty
    // record before the status flips, so a failed provision never leaves the
    // request stuck at "IN_PROGRESS -> COMPLETED" with no faculty behind it.
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
    } else if (action === "LINK_EXISTING_ACCOUNT") {
      if (!body.existingUid?.trim()) {
        return NextResponse.json({ error: "existingUid is required to link an existing account" }, { status: 400 });
      }
      const result = await linkFacultyToExistingAccount(db, session.collegeId, reqData.offerId, body.existingUid.trim());
      if (result.status === "not_found") {
        return NextResponse.json({ error: "Offer letter or candidate not found" }, { status: 404 });
      }
      if (result.status === "existing_user_not_found") {
        return NextResponse.json({ error: "The selected existing account could not be found" }, { status: 404 });
      }
      facultyId = result.facultyId;
      if (result.status === "linked") {
        employeeId = result.employeeId;
        assignedEmail = result.assignedEmail;
      }
    }

    await reqRef.update({
      status: transition.to,
      history: [...(reqData.history ?? []), ...newHistoryEntries],
      ...(facultyId ? { facultyId } : {}),
      ...(assignedEmail ? { assignedEmail } : {}),
      ...(generatedPassword ? { credentialResult: { password: generatedPassword, revealed: false } } : {}),
      updatedAt: now,
    });

    // Notify Office as soon as the login actually exists (CREATE_CREDENTIALS or
    // LINK_EXISTING_ACCOUNT) - the request is already COMPLETED by this point,
    // so this is the only signal Office gets that credentials are ready to
    // reveal. A linked account has no new password to reveal, so its message
    // points Office at the existing login instead.
    if ((action === "CREATE_CREDENTIALS" || action === "LINK_EXISTING_ACCOUNT") && reqData.requestedBy) {
      await collegeRef.collection("notifications").add({
        collegeId: session.collegeId,
        toUid: reqData.requestedBy,
        type: "FACULTY_ACCOUNT_REQUEST_CREDENTIALS_CREATED",
        title: "Faculty Account Created",
        message: action === "LINK_EXISTING_ACCOUNT"
          ? `${reqData.candidateName ?? "The candidate"} has been linked to their existing login (${assignedEmail ?? "no new credentials created"}).`
          : `The faculty account for ${reqData.candidateName ?? "the candidate"} has been created — reveal the login credentials from Faculty Credentials.`,
        link: `/college-office/settings/faculty-credentials`,
        read: false,
        createdAt: now,
      });
    }

    // Credential creation is the terminal step of the whole hiring pipeline now
    // (there's no further "official email" stage after it) - tell the HOD who
    // raised the vacancy and every Principal/Vice Principal the hire is done.
    if ((action === "CREATE_CREDENTIALS" || action === "LINK_EXISTING_ACCOUNT") && facultyId) {
      try {
        const offerSnap = await collegeRef.collection("offerLetters").doc(reqData.offerId).get();
        const offerBatchId = (offerSnap.data() as { batchId?: string } | undefined)?.batchId;
        const batchSnap = offerBatchId ? await collegeRef.collection("hiringBatches").doc(offerBatchId).get() : null;
        const vacancyId = (batchSnap?.data() as { vacancyId?: string } | undefined)?.vacancyId;
        const vacancySnap = vacancyId ? await collegeRef.collection("vacancyRequests").doc(vacancyId).get() : null;
        const hodUid = (vacancySnap?.data() as { hodUid?: string } | undefined)?.hodUid;

        const hiredMessage = `${reqData.candidateName ?? "The candidate"} has been hired as ${reqData.designation ?? "faculty"} in ${reqData.department ?? "the department"} — the hiring cycle is now closed.`;
        if (hodUid) {
          await notify(db, session.collegeId, hodUid, "CANDIDATE_HIRED", "Candidate Hired", hiredMessage, "/hod/pipeline");
        }
        await notifyRole(db, session.collegeId, "PRINCIPAL", "CANDIDATE_HIRED", "Candidate Hired", hiredMessage, "/principal/vacancies");
        await notifyRole(db, session.collegeId, "VICE_PRINCIPAL", "CANDIDATE_HIRED", "Candidate Hired", hiredMessage, "/principal/vacancies");
      } catch (err) {
        console.error("[faculty-account-requests CREATE_CREDENTIALS notify HOD/Principal]", err);
      }
    }

    const auditActionMap: Record<Exclude<Action, "REVEAL_CREDENTIALS">, string> = {
      START_REVIEW: "FACULTY_ACCOUNT_REQUEST_IN_PROGRESS",
      CREATE_CREDENTIALS: "FACULTY_ACCOUNT_REQUEST_CREDENTIALS_CREATED",
      LINK_EXISTING_ACCOUNT: "FACULTY_ACCOUNT_REQUEST_LINKED_EXISTING_ACCOUNT",
    };
    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: auditActionMap[action as Exclude<Action, "REVEAL_CREDENTIALS">],
      performedBy: session.uid,
      performedByName: actorName,
      targetId: id,
      // facultyId/assignedEmail are only set during CREATE_CREDENTIALS/
      // LINK_EXISTING_ACCOUNT — omit them for other actions so Firestore
      // doesn't reject undefined values.
      details: {
        ...(facultyId ? { facultyId } : {}),
        ...(assignedEmail ? { assignedEmail } : {}),
      },
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
