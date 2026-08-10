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
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER", "ACCOUNTS");
    const { id } = await params;
    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("candidateApplications")
      .doc(id)
      .get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ application: { id: snap.id, ...snap.data() } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[candidate-applications/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_OFFICE", "ACCOUNTS");
    const { id } = await params;
    const body = (await request.json()) as {
      isShortlisted?: boolean;
      hasArrived?: boolean;
      status?: string;
      stage?: string;
      batchId?: string;
      documentVerification?: { checkedDocs: Record<string, boolean> };
      joiningLetterUrl?: string;
      expectedSalary?: number;
      negotiatedSalary?: number;
      dateOfJoining?: string;
      termsAndConditions?: string[];
      committeeRecommendation?: string;
      notifyPrincipalDocsReady?: boolean;
    };

    const db = getAdminDb();
    const actorName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const applicationSnap = await collegeRef.collection("candidateApplications").doc(id).get();

    if (!applicationSnap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const isPrincipalRole = session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL" || session.role === "SUPER_ADMIN";
    const isHodRole = session.role === "HOD";
    const isCollegeOfficeRole = session.role === "COLLEGE_OFFICE";

    const { isShortlisted, hasArrived, status, stage, batchId, documentVerification, joiningLetterUrl, expectedSalary, negotiatedSalary, dateOfJoining, termsAndConditions, committeeRecommendation, notifyPrincipalDocsReady } = body;

    // Field-level role gating - each field group is only ever written by one
    // stage's UI, so an unrelated role sending it (by mistake or a crafted
    // request) is rejected outright rather than silently accepted.
    if (isShortlisted !== undefined && !isHodRole && !isPrincipalRole) {
      return NextResponse.json({ error: "Only the HOD or Principal can update the shortlist" }, { status: 403 });
    }
    if (hasArrived !== undefined && session.role !== "HOD" && session.role !== "PANEL_MEMBER" && !isPrincipalRole) {
      return NextResponse.json({ error: "Only the HOD or panel can mark a candidate as arrived" }, { status: 403 });
    }
    if (batchId !== undefined && !isHodRole && !isPrincipalRole) {
      return NextResponse.json({ error: "Only the HOD or Principal can reassign a candidate's batch" }, { status: 403 });
    }
    if ((status !== undefined || stage !== undefined || committeeRecommendation !== undefined) && !isPrincipalRole) {
      return NextResponse.json({ error: "Only the Principal can record a hiring decision" }, { status: 403 });
    }
    if (
      (expectedSalary !== undefined || negotiatedSalary !== undefined || dateOfJoining !== undefined || termsAndConditions !== undefined) &&
      !isPrincipalRole
    ) {
      return NextResponse.json({ error: "Only the Principal can set negotiation terms" }, { status: 403 });
    }
    if (
      (documentVerification !== undefined || joiningLetterUrl !== undefined || notifyPrincipalDocsReady) &&
      !isCollegeOfficeRole && !isPrincipalRole
    ) {
      return NextResponse.json({ error: "Only the College Office can update documents" }, { status: 403 });
    }

    // A Principal decision is terminal - once APPROVED/REJECTED, it can't be
    // silently flipped by a later request (e.g. a stale tab resubmitting).
    const existingStatus = (applicationSnap.data() as { status?: string }).status;
    if (status !== undefined && (existingStatus === "APPROVED" || existingStatus === "REJECTED") && status !== existingStatus) {
      return NextResponse.json({ error: `This candidate's decision is already final (${existingStatus})` }, { status: 409 });
    }

    const updates: Record<string, unknown> = { updatedAt: now };

    if (isShortlisted !== undefined) updates.isShortlisted = isShortlisted;
    if (hasArrived !== undefined) {
      updates.hasArrived = hasArrived;
      if (hasArrived) {
        updates.arrivedAt = now;
        updates.status = "ARRIVED";
      }
    }
    if (status !== undefined) updates.status = status;
    if (stage !== undefined) updates.currentStage = stage;
    if (batchId !== undefined) {
      updates.batchId = batchId;
    } else if (status === "REJECTED") {
      // A final REJECTED decision means this application was not hired — free it
      // from its batch so the candidate is selectable again for a future
      // interview round under a new application (they remain shortlisted here,
      // just no longer tied to this batch).
      // Kept as an explicit else-if (not two separate statements) so a caller
      // that ever sends both batchId and status:"REJECTED" together can't
      // accidentally skip this by having the two conditions drift apart.
      updates.batchId = "";
    }
    if (documentVerification !== undefined) {
      const applicationBatchId = (applicationSnap.data() as { batchId?: string }).batchId;
      let allVerified = Object.keys(documentVerification.checkedDocs).length > 0
        && Object.values(documentVerification.checkedDocs).every(Boolean);
      if (applicationBatchId) {
        const batchSnap = await collegeRef.collection("hiringBatches").doc(applicationBatchId).get();
        const requiredDocuments = (batchSnap.data() as { requiredDocuments?: string[] } | undefined)?.requiredDocuments ?? [];
        allVerified = requiredDocuments.length === 0 || requiredDocuments.every((d) => documentVerification.checkedDocs[d] === true);
      }
      updates.documentVerification = {
        checkedDocs: documentVerification.checkedDocs,
        verifiedBy: session.uid,
        verifiedByName: actorName,
        verifiedAt: now,
        allVerified,
      };
    }
    if (joiningLetterUrl !== undefined) {
      updates.joiningLetterUrl = joiningLetterUrl;
      updates.joiningLetterUploadedAt = now;
      updates.joiningLetterUploadedByName = actorName;
    }
    if (expectedSalary !== undefined) updates.expectedSalary = expectedSalary;
    if (negotiatedSalary !== undefined) updates.negotiatedSalary = negotiatedSalary;
    if (dateOfJoining !== undefined) updates.dateOfJoining = dateOfJoining;
    if (termsAndConditions !== undefined) updates.termsAndConditions = termsAndConditions;
    if (committeeRecommendation !== undefined) updates.committeeRecommendation = committeeRecommendation;
    if (notifyPrincipalDocsReady) updates["documentVerification.notifiedPrincipalAt"] = now;

    await collegeRef.collection("candidateApplications").doc(id).update(updates);

    const applicationData = applicationSnap.data() as { candidateId?: string; batchId?: string; vacancyRequestId?: string };
    const candidateSnap = applicationData.candidateId
      ? await collegeRef.collection("candidates").doc(applicationData.candidateId).get()
      : null;
    const candidateName = (candidateSnap?.data() as { name?: string } | undefined)?.name;

    // A Principal APPROVED decision fills one of the vacancy's open posts -
    // requiredCount otherwise stays frozen at its original value forever, so
    // every "N posts open" picker keeps offering posts that are already filled.
    // The re-decision guard above ensures this only ever fires once per application.
    if (status === "APPROVED" && applicationData.vacancyRequestId) {
      const vacancyRef = collegeRef.collection("vacancyRequests").doc(applicationData.vacancyRequestId);
      const vacancySnap = await vacancyRef.get();
      const currentRequired = (vacancySnap.data() as { requiredCount?: number } | undefined)?.requiredCount ?? 0;
      if (currentRequired > 0) {
        await vacancyRef.update({ requiredCount: currentRequired - 1, updatedAt: now });
      }
    }

    // If candidate arrived, notify panel members and college office
    if (hasArrived) {
      if (applicationData.batchId) {
        const batchSnap = await collegeRef.collection("hiringBatches").doc(applicationData.batchId).get();

        if (batchSnap.exists) {
          const batch = batchSnap.data() as { panelMemberUids?: string[]; position?: string };
          const uidsToNotify = [...(batch.panelMemberUids ?? [])];

          const officeSnap = await collegeRef
            .collection("users")
            .where("role", "==", "COLLEGE_OFFICE")
            .get();
          for (const d of officeSnap.docs) uidsToNotify.push(d.id);

          const writeBatch = db.batch();
          for (const uid of uidsToNotify) {
            const notifRef = collegeRef.collection("notifications").doc();
            writeBatch.set(notifRef, {
              collegeId: session.collegeId,
              toUid: uid,
              type: "CANDIDATE_ARRIVED",
              title: "Candidate Has Arrived",
              message: `${candidateName ?? "A candidate"} has arrived for the ${batch.position ?? "interview"}.`,
              link: `/panel/interviews/${applicationData.batchId}`,
              read: false,
              createdAt: now,
            });
          }
          await writeBatch.commit();
        }
      }

      await collegeRef.collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "CANDIDATE_ARRIVED",
        performedBy: session.uid,
        performedByName: actorName,
        targetId: id,
        details: { candidateName },
        timestamp: now,
      });
    }

    if (isShortlisted !== undefined) {
      await collegeRef.collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "CANDIDATE_SHORTLISTED",
        performedBy: session.uid,
        performedByName: actorName,
        targetId: id,
        details: { isShortlisted },
        timestamp: now,
      });
    }

    if (documentVerification !== undefined) {
      const checkedCount = Object.values(documentVerification.checkedDocs).filter(Boolean).length;
      await collegeRef.collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "DOCUMENTS_VERIFIED",
        performedBy: session.uid,
        performedByName: actorName,
        targetId: id,
        details: { checkedCount, totalCount: Object.keys(documentVerification.checkedDocs).length },
        timestamp: now,
      });
    }

    if (joiningLetterUrl !== undefined) {
      await collegeRef.collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "JOINING_LETTER_UPLOADED",
        performedBy: session.uid,
        performedByName: actorName,
        targetId: id,
        details: {},
        timestamp: now,
      });
    }

    // Final Principal decision: notify the HOD, log it, and — if every other
    // application in the batch already has a decision — close out the batch
    // server-side instead of relying on the client to notice and follow up.
    if ((status === "APPROVED" || status === "REJECTED") && applicationData.batchId) {
      const batchRef = collegeRef.collection("hiringBatches").doc(applicationData.batchId);
      const batchSnap = await batchRef.get();

      if (batchSnap.exists) {
        const batch = batchSnap.data() as { hodUid?: string; position?: string };

        if (batch.hodUid) {
          await collegeRef.collection("notifications").add({
            collegeId: session.collegeId,
            toUid: batch.hodUid,
            type: status === "APPROVED" ? "HIRING_APPROVED" : "HIRING_REJECTED",
            title: status === "APPROVED" ? "Candidate Approved" : "Candidate Rejected",
            message: `${candidateName ?? "A candidate"} for ${batch.position ?? "the position"} was ${status === "APPROVED" ? "approved" : "rejected"} by the Principal.`,
            link: `/hod/batches/${applicationData.batchId}`,
            read: false,
            createdAt: now,
          });
        }

        await collegeRef.collection("auditLogs").add({
          collegeId: session.collegeId,
          action: "HIRING_DECISION_MADE",
          performedBy: session.uid,
          performedByName: actorName,
          targetId: id,
          details: { status, batchId: applicationData.batchId },
          timestamp: now,
        });

        const siblingsSnap = await collegeRef
          .collection("candidateApplications")
          .where("batchId", "==", applicationData.batchId)
          .get();
        const allDecided = siblingsSnap.docs.every((d) => {
          if (d.id === id) return true; // just decided above
          const s = (d.data() as { status?: string }).status;
          return s === "APPROVED" || s === "REJECTED";
        });
        if (allDecided) {
          await batchRef.update({ currentPhase: "COMPLETED", status: "COMPLETED", updatedAt: now });
        }
      }
    }

    // Candidate approved → notify College Office to send the offer letter
    if (stage === "DECISION" && status !== "REJECTED") {
      const officeSnap = await collegeRef
        .collection("users")
        .where("role", "==", "COLLEGE_OFFICE")
        .get();
      for (const officeDoc of officeSnap.docs) {
        await collegeRef.collection("notifications").add({
          collegeId: session.collegeId,
          toUid: officeDoc.id,
          type: "GENERAL",
          title: "Candidate Ready for Offer Letter",
          message: `${candidateName ?? "A candidate"} has been approved. Please send the offer letter.`,
          link: `/college-office/documents`,
          read: false,
          createdAt: now,
        });
      }
    }

    // Office has verified documents → notify Principal the appointment letter can go out
    if (notifyPrincipalDocsReady) {
      const principalSnap = await collegeRef
        .collection("users")
        .where("role", "in", ["PRINCIPAL", "VICE_PRINCIPAL"])
        .get();
      for (const principalDoc of principalSnap.docs) {
        await collegeRef.collection("notifications").add({
          collegeId: session.collegeId,
          toUid: principalDoc.id,
          type: "GENERAL",
          title: "Documents Verified — Ready for Appointment Letter",
          message: `${candidateName ?? "A candidate"}'s documents have been verified. You can now send the appointment letter.`,
          link: `/principal/appointment-letters`,
          read: false,
          createdAt: now,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[candidate-applications/[id] PATCH]", err);
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
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const applicationSnap = await collegeRef.collection("candidateApplications").doc(id).get();
    if (!applicationSnap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { batchId } = applicationSnap.data() as { batchId?: string };
    if (batchId) {
      return NextResponse.json({ error: "Cannot withdraw an application already assigned to an interview batch" }, { status: 400 });
    }

    await collegeRef.collection("candidateApplications").doc(id).delete();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[candidate-applications/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
