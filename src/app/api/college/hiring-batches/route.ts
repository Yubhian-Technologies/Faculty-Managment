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
      "PRINCIPAL", "HOD", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER", "ACCOUNTS"
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

    if (session.role === "HOD") {
      batches = batches.filter((b) => (b as { hodUid?: string }).hodUid === session.uid);
    }

    if (session.role === "PANEL_MEMBER") {
      batches = batches.filter((b) => {
        const batch = b as { panelMemberUids?: string[]; coordinatorUid?: string; status?: string };
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
      candidateIds: string[];
      interviewDate: string;
    };

    const { vacancyId, department, position, panelMemberUids, candidateIds, interviewDate } = body;
    if (!vacancyId || !department || !position || !panelMemberUids?.length || !candidateIds?.length || !interviewDate) {
      return NextResponse.json({ error: "vacancyId, department, position, panelMemberUids, candidateIds, interviewDate required" }, { status: 400 });
    }

    const db = getAdminDb();
    const hodName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    const ref = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("hiringBatches")
      .add({
        collegeId: session.collegeId,
        vacancyId,
        department,
        position,
        hodUid: session.uid,
        hodName,
        panelMemberUids,
        candidateIds,
        interviewDate: new Date(interviewDate),
        interviewVenue: "",
        demoClassroom: "",
        coordinatorName: "",
        requiredDocuments: [],
        status: "PENDING",
        principalApprovalStatus: "PENDING",
        setupComplete: false,
        createdAt: now,
        updatedAt: now,
      });

    // Update all candidates with this batchId
    const writeBatch = db.batch();
    for (const cid of candidateIds) {
      const cRef = db.collection("colleges").doc(session.collegeId).collection("candidates").doc(cid);
      writeBatch.update(cRef, { batchId: ref.id, isShortlisted: true, status: "SHORTLISTED", updatedAt: now });
    }
    await writeBatch.commit();

    // Notify Principal
    const principalsSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("users")
      .where("role", "==", "PRINCIPAL")
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
      details: { position, department, candidateCount: candidateIds.length },
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
