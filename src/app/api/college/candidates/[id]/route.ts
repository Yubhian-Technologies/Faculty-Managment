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
      .collection("candidates")
      .doc(id)
      .get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ candidate: { id: snap.id, ...snap.data() } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[candidates/[id] GET]", err);
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
      resumeUrl?: string;
      name?: string;
      email?: string;
      phone?: string;
    };

    const db = getAdminDb();
    const actorName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    const candidateSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("candidates")
      .doc(id)
      .get();

    if (!candidateSnap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updatedAt: now };
    const { isShortlisted, hasArrived, status, stage, batchId, resumeUrl, name, email, phone } = body;

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
    if (batchId !== undefined) updates.batchId = batchId;
    if (resumeUrl !== undefined) updates.resumeUrl = resumeUrl;
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;

    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("candidates")
      .doc(id)
      .update(updates);

    // If candidate arrived, notify panel members and college office
    if (hasArrived) {
      const candidateData = candidateSnap.data() as { name?: string; batchId?: string };

      if (candidateData.batchId) {
        const batchSnap = await db
          .collection("colleges")
          .doc(session.collegeId)
          .collection("hiringBatches")
          .doc(candidateData.batchId)
          .get();

        if (batchSnap.exists) {
          const batch = batchSnap.data() as { panelMemberUids?: string[]; position?: string };
          const uidsToNotify = [...(batch.panelMemberUids ?? [])];

          const officeSnap = await db
            .collection("colleges")
            .doc(session.collegeId)
            .collection("users")
            .where("role", "==", "COLLEGE_OFFICE")
            .get();
          for (const d of officeSnap.docs) uidsToNotify.push(d.id);

          const writeBatch = db.batch();
          for (const uid of uidsToNotify) {
            const notifRef = db.collection("colleges").doc(session.collegeId).collection("notifications").doc();
            writeBatch.set(notifRef, {
              collegeId: session.collegeId,
              toUid: uid,
              type: "CANDIDATE_ARRIVED",
              title: "Candidate Has Arrived",
              message: `${candidateData.name ?? "A candidate"} has arrived for the ${batch.position ?? "interview"}.`,
              link: `/panel/interviews/${candidateData.batchId}`,
              read: false,
              createdAt: now,
            });
          }
          await writeBatch.commit();
        }
      }

      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "CANDIDATE_ARRIVED",
        performedBy: session.uid,
        performedByName: actorName,
        targetId: id,
        details: { candidateName: (candidateSnap.data() as { name?: string }).name },
        timestamp: now,
      });
    }

    if (isShortlisted !== undefined) {
      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "CANDIDATE_SHORTLISTED",
        performedBy: session.uid,
        performedByName: actorName,
        targetId: id,
        details: { isShortlisted },
        timestamp: now,
      });
    }

    const candidateData = candidateSnap.data() as { name?: string; batchId?: string };

    // Final Principal decision: notify the HOD, log it, and — if every other
    // candidate in the batch already has a decision — close out the batch
    // server-side instead of relying on the client to notice and follow up.
    if ((status === "APPROVED" || status === "REJECTED") && candidateData.batchId) {
      const batchRef = db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("hiringBatches")
        .doc(candidateData.batchId);
      const batchSnap = await batchRef.get();

      if (batchSnap.exists) {
        const batch = batchSnap.data() as { hodUid?: string; position?: string };

        if (batch.hodUid) {
          await db.collection("colleges").doc(session.collegeId).collection("notifications").add({
            collegeId: session.collegeId,
            toUid: batch.hodUid,
            type: status === "APPROVED" ? "HIRING_APPROVED" : "HIRING_REJECTED",
            title: status === "APPROVED" ? "Candidate Approved" : "Candidate Rejected",
            message: `${candidateData.name ?? "A candidate"} for ${batch.position ?? "the position"} was ${status === "APPROVED" ? "approved" : "rejected"} by the Principal.`,
            link: `/hod/batches/${candidateData.batchId}`,
            read: false,
            createdAt: now,
          });
        }

        await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
          collegeId: session.collegeId,
          action: "HIRING_DECISION_MADE",
          performedBy: session.uid,
          performedByName: actorName,
          targetId: id,
          details: { status, batchId: candidateData.batchId },
          timestamp: now,
        });

        const siblingsSnap = await db
          .collection("colleges")
          .doc(session.collegeId)
          .collection("candidates")
          .where("batchId", "==", candidateData.batchId)
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

    // Documents verified → candidate ready for the HOD to send the offer letter
    if (stage === "DECISION" && status !== "REJECTED") {
      const batchIdForNotif = candidateData.batchId;
      const hodUidForNotif = batchIdForNotif
        ? ((await db.collection("colleges").doc(session.collegeId).collection("hiringBatches").doc(batchIdForNotif).get())
            .data() as { hodUid?: string } | undefined)?.hodUid
        : undefined;
      if (hodUidForNotif) {
        await db.collection("colleges").doc(session.collegeId).collection("notifications").add({
          collegeId: session.collegeId,
          toUid: hodUidForNotif,
          type: "GENERAL",
          title: "Candidate Ready for Offer",
          message: `${candidateData.name ?? "A candidate"}'s documents are verified. Please send the offer letter.`,
          link: `/hod/offers/new`,
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
    console.error("[candidates/[id] PATCH]", err);
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

    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("candidates")
      .doc(id)
      .delete();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[candidates/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
