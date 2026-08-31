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

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER", "ACCOUNTS", "COLLEGE_ACCOUNTS"
    );
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const panelMemberUid = searchParams.get("panelMemberUid");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("hiringBatches")
      .orderBy("createdAt", "desc")
      .get();

    let batches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const asPanelMember = searchParams.get("asPanelMember") === "true";

    if (asPanelMember) {
      // Any role: return batches where this user is a panel member (for scoring)
      batches = batches.filter((b) =>
        ((b as { panelMemberUids?: string[] }).panelMemberUids ?? []).includes(session.uid)
      );
      batches = batches.filter((b) => (b as { status?: string }).status !== "REJECTED");
    } else if (session.role === "HOD") {
      batches = batches.filter((b) => (b as { hodUid?: string }).hodUid === session.uid);
    } else if (session.role === "PANEL_MEMBER") {
      batches = batches.filter((b) => {
        const batch = b as { panelMemberUids?: string[]; coordinatorUid?: string };
        return (
          (batch.panelMemberUids ?? []).includes(session.uid) ||
          batch.coordinatorUid === session.uid
        );
      });
      batches = batches.filter((b) => (b as { status?: string }).status !== "REJECTED");
    }

    if (status) {
      batches = batches.filter((b) => (b as { status?: string }).status === status);
    }

    if (panelMemberUid && session.role !== "PANEL_MEMBER") {
      batches = batches.filter((b) =>
        ((b as { panelMemberUids?: string[] }).panelMemberUids ?? []).includes(panelMemberUid)
      );
    }

    return NextResponse.json({ batches });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/hiring-batches GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "SUPER_ADMIN");
    const body = (await request.json()) as {
      vacancyId: string;
      department: string;
      position: string;
      panelMemberUids: string[];
      applicationIds: string[];
      interviewDate: string;
      interviewTime?: string;
      hiringMode?: "ONLINE" | "OFFLINE";
      meetingPlatform?: string;
      meetingLink?: string;
    };

    const { vacancyId, department, position, panelMemberUids, applicationIds, interviewDate, interviewTime, hiringMode, meetingPlatform, meetingLink } = body;
    if (!vacancyId || !department || !position || !panelMemberUids?.length || !applicationIds?.length || !interviewDate) {
      return NextResponse.json({ error: "vacancyId, department, position, panelMemberUids, applicationIds, interviewDate required" }, { status: 400 });
    }
    if (hiringMode === "ONLINE" && (!meetingPlatform || !meetingLink)) {
      return NextResponse.json({ error: "meetingPlatform and meetingLink required for an online interview" }, { status: 400 });
    }

    const db = getAdminDb();
    const hodName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const batchRef = collegeRef.collection("hiringBatches").doc();
    const appRefs = applicationIds.map((aid) => collegeRef.collection("candidateApplications").doc(aid));

    // Transactional create + re-check: without this, two HODs (or two tabs)
    // batching the same shortlisted candidate at nearly the same time could
    // both read "unbatched" and both succeed, silently double-booking the
    // candidate into two interview batches at once.
    try {
      await db.runTransaction(async (tx) => {
        const appSnaps = await Promise.all(appRefs.map((r) => tx.get(r)));
        for (let i = 0; i < appSnaps.length; i++) {
          if (!appSnaps[i].exists) {
            throw new Error(`APPLICATION_NOT_FOUND:${applicationIds[i]}`);
          }
          const existingBatchId = (appSnaps[i].data() as { batchId?: string }).batchId;
          if (existingBatchId) {
            throw new Error(`ALREADY_BATCHED:${applicationIds[i]}`);
          }
        }

        tx.set(batchRef, {
          collegeId: session.collegeId,
          vacancyId,
          department,
          position,
          hodUid: session.uid,
          hodName,
          panelMemberUids,
          applicationIds,
          interviewDate: new Date(interviewDate),
          interviewTime: interviewTime ?? "",
          interviewVenue: "",
          demoClassroom: "",
          coordinatorName: "",
          requiredDocuments: [],
          hiringMode: hiringMode === "ONLINE" ? "ONLINE" : "OFFLINE",
          meetingPlatform: meetingPlatform ?? "",
          meetingLink: meetingLink ?? "",
          status: "PENDING",
          currentPhase: "PRINCIPAL_REVIEW",
          principalApprovalStatus: "PENDING",
          setupComplete: false,
          createdAt: now,
          updatedAt: now,
        });
        for (const r of appRefs) {
          tx.update(r, { batchId: batchRef.id, isShortlisted: true, status: "SHORTLISTED", updatedAt: now });
        }
      });
    } catch (txErr) {
      if (txErr instanceof Error && txErr.message.startsWith("ALREADY_BATCHED:")) {
        return NextResponse.json({ error: "One or more candidates have already been added to another interview batch" }, { status: 409 });
      }
      if (txErr instanceof Error && txErr.message.startsWith("APPLICATION_NOT_FOUND:")) {
        return NextResponse.json({ error: "One or more selected candidates could not be found" }, { status: 404 });
      }
      throw txErr;
    }

    const ref = batchRef;

    // Notify Principal (and College Admin, who mirrors Principal's authority)
    const principalsSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("users")
      .where("role", "in", ["PRINCIPAL", "COLLEGE_ADMIN"])
      .get();

    const notifBatch = db.batch();
    for (const p of principalsSnap.docs) {
      const notifRef = db.collection("colleges").doc(session.collegeId).collection("notifications").doc();
      notifBatch.set(notifRef, {
        collegeId: session.collegeId,
        toUid: p.id,
        type: "GENERAL",
        title: "Interview Panel Proposal",
        message: `${hodName} submitted an interview panel proposal for ${position} in ${department}.`,
        link: `/principal/interviews`,
        read: false,
        createdAt: now,
      });
    }
    await notifBatch.commit();

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "HIRING_BATCH_CREATED",
      performedBy: session.uid,
      performedByName: hodName,
      targetId: ref.id,
      details: { position, department, candidateCount: applicationIds.length },
      timestamp: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/hiring-batches POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
