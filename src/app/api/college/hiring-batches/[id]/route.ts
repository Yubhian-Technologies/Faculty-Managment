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
    const session = await requireCollegeMember(
      "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER", "ACCOUNTS"
    );
    const { id } = await params;
    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("hiringBatches")
      .doc(id)
      .get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const data = snap.data() as Record<string, unknown>;

    // Auto-heal: demo marked complete but phase never advanced (pre-fix data)
    if (data.demoComplete === true && data.currentPhase === "INTERVIEW_READY") {
      await snap.ref.update({ currentPhase: "IN_PROGRESS", updatedAt: new Date() });
      data.currentPhase = "IN_PROGRESS";
    }

    return NextResponse.json({ batch: { id: snap.id, ...data } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[hiring-batches/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember(
      "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER"
    );
    const { id } = await params;
    const body = (await request.json()) as {
      // Principal actions
      status?: string;
      principalNotes?: string;
      // Phase transition
      currentPhase?: string;
      // College Office actions
      interviewVenue?: string;
      requiredDocuments?: string[];
      setupComplete?: boolean;
      // HOD finalization
      demoClassroom?: string;
      meetingLink?: string;
      coordinatorFacultyId?: string;
      panelMemberUids?: string[];
      candidateIds?: string[];
      interviewDate?: string;
      interviewTime?: string;
      // Coordinator action
      demoComplete?: boolean;
    };

    const db = getAdminDb();
    const actorName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    const batchSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("hiringBatches")
      .doc(id)
      .get();

    if (!batchSnap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const batchData = batchSnap.data() as {
      hodUid: string;
      panelMemberUids: string[];
      position: string;
      department: string;
      demoComplete?: boolean;
    };

    const updates: Record<string, unknown> = { updatedAt: now };

    // Principal: approve / reject / modify
    if (body.status !== undefined) updates.status = body.status;
    if (body.principalNotes !== undefined) updates.principalNotes = body.principalNotes;
    if (body.currentPhase !== undefined) updates.currentPhase = body.currentPhase;
    // When Principal approves, transition phase so HOD can set up logistics
    if (body.status === "APPROVED") {
      updates.currentPhase = "HOD_FINAL_SETUP";
    }
    // College Office: venue + docs
    if (body.interviewVenue !== undefined) updates.interviewVenue = body.interviewVenue;
    if (body.requiredDocuments !== undefined) updates.requiredDocuments = body.requiredDocuments;
    if (body.setupComplete !== undefined) updates.setupComplete = body.setupComplete;
    // HOD: demo + coordinator (resolved from faculty register)
    if (body.demoClassroom !== undefined) updates.demoClassroom = body.demoClassroom;
    if (body.meetingLink !== undefined) updates.meetingLink = body.meetingLink;
    if (body.coordinatorFacultyId !== undefined) {
      const facultySnap = await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("facultyMembers")
        .doc(body.coordinatorFacultyId)
        .get();
      const faculty = facultySnap.data() as { name?: string; userUid?: string } | undefined;
      updates.coordinatorFacultyId = body.coordinatorFacultyId;
      updates.coordinatorName = faculty?.name ?? "Unknown";
      updates.coordinatorUid = faculty?.userUid ?? null;
    }
    if (body.panelMemberUids !== undefined) updates.panelMemberUids = body.panelMemberUids;
    if (body.candidateIds !== undefined) updates.candidateIds = body.candidateIds;
    if (body.interviewDate !== undefined) updates.interviewDate = new Date(body.interviewDate);
    if (body.interviewTime !== undefined) updates.interviewTime = body.interviewTime;
    if (body.demoComplete === true) {
      updates.demoComplete = true;
      updates.currentPhase = "IN_PROGRESS"; // demo day is done; HOD reviews before opening panel scoring
    }

    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("hiringBatches")
      .doc(id)
      .update(updates);

    // Notifications based on what changed
    const notifBatch = db.batch();

    if (body.status === "APPROVED") {

      const hodNotifRef = db.collection("colleges").doc(session.collegeId).collection("notifications").doc();
      notifBatch.set(hodNotifRef, {
        collegeId: session.collegeId,
        toUid: batchData.hodUid,
        type: "INTERVIEW_PLAN_APPROVED",
        title: "Interview Plan Approved — Please Set Up Logistics",
        message: `Your interview plan for ${batchData.position} has been approved. Please add the venue, required documents, demo classroom, and coordinator.`,
        link: `/hod/batches/${id}`,
        read: false,
        createdAt: now,
      });
    } else if (body.status === "REJECTED") {
      const hodNotifRef = db.collection("colleges").doc(session.collegeId).collection("notifications").doc();
      notifBatch.set(hodNotifRef, {
        collegeId: session.collegeId,
        toUid: batchData.hodUid,
        type: "INTERVIEW_PLAN_REJECTED",
        title: "Interview Plan Rejected",
        message: `Your interview plan for ${batchData.position} was rejected.${body.principalNotes ? ` Notes: ${body.principalNotes}` : ""}`,
        link: `/hod/batches/${id}`,
        read: false,
        createdAt: now,
      });
    } else if (body.status === "MODIFIED") {
      const hodNotifRef = db.collection("colleges").doc(session.collegeId).collection("notifications").doc();
      notifBatch.set(hodNotifRef, {
        collegeId: session.collegeId,
        toUid: batchData.hodUid,
        type: "INTERVIEW_PLAN_MODIFIED",
        title: "Interview Plan Modified",
        message: `Your interview plan for ${batchData.position} was modified. Please review and resubmit.${body.principalNotes ? ` Notes: ${body.principalNotes}` : ""}`,
        link: `/hod/batches/${id}`,
        read: false,
        createdAt: now,
      });
    }

    // Notify coordinator when assigned (only if they have a login account)
    const resolvedCoordinatorUid = updates.coordinatorUid as string | null | undefined;
    if (body.coordinatorFacultyId && resolvedCoordinatorUid) {
      const coordRef = db.collection("colleges").doc(session.collegeId).collection("notifications").doc();
      notifBatch.set(coordRef, {
        collegeId: session.collegeId,
        toUid: resolvedCoordinatorUid,
        type: "COORDINATOR_ASSIGNED",
        title: "You are the Demo Coordinator",
        message: `You have been assigned as coordinator for the ${batchData.position} interview (${batchData.department}). Display QR codes during the demo class to collect student feedback.`,
        link: `/coordinator/${id}`,
        read: false,
        createdAt: now,
      });
    }

    // If HOD releases to panel interview, notify all panel members
    if (body.currentPhase === "PANEL_INTERVIEW") {
      for (const panelUid of (batchData.panelMemberUids ?? [])) {
        const panelRef = db.collection("colleges").doc(session.collegeId).collection("notifications").doc();
        notifBatch.set(panelRef, {
          collegeId: session.collegeId,
          toUid: panelUid,
          type: "GENERAL",
          title: "Panel Interview Scoring Open",
          message: `HOD has reviewed the demo scores for ${batchData.position}. Please submit your interview assessment now.`,
          link: `/panel/interviews/${id}`,
          read: false,
          createdAt: now,
        });
      }
    }

    // If transitioning to PRINCIPAL_FINAL_REVIEW, notify all Principals
    if (body.currentPhase === "PRINCIPAL_FINAL_REVIEW") {
      const principalSnap = await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("users")
        .where("role", "==", "PRINCIPAL")
        .get();
      for (const d of principalSnap.docs) {
        const ref = db.collection("colleges").doc(session.collegeId).collection("notifications").doc();
        notifBatch.set(ref, {
          collegeId: session.collegeId,
          toUid: d.id,
          type: "GENERAL",
          title: "Evaluation Ready for Review",
          message: `Interview evaluations for ${batchData.position} (${batchData.department}) are complete. Please review and make final hiring decisions.`,
          link: `/principal/decisions/${id}`,
          read: false,
          createdAt: now,
        });
      }
    }

    // If demo marked complete, notify HOD and all panel members
    if (body.demoComplete === true && !batchData.demoComplete) {
      const hodRef = db.collection("colleges").doc(session.collegeId).collection("notifications").doc();
      notifBatch.set(hodRef, {
        collegeId: session.collegeId,
        toUid: batchData.hodUid,
        type: "GENERAL",
        title: "Demo Class Complete",
        message: `Demo class for ${batchData.position} is done. Panel members can now submit their interview feedback.`,
        link: `/hod/batches/${id}`,
        read: false,
        createdAt: now,
      });
      for (const panelUid of (batchData.panelMemberUids ?? [])) {
        const panelRef = db.collection("colleges").doc(session.collegeId).collection("notifications").doc();
        notifBatch.set(panelRef, {
          collegeId: session.collegeId,
          toUid: panelUid,
          type: "GENERAL",
          title: "Panel Feedback Unlocked",
          message: `Demo for ${batchData.position} is complete. Please submit your interview feedback now.`,
          link: `/panel/interviews/${id}`,
          read: false,
          createdAt: now,
        });
      }
    }

    await notifBatch.commit();

    if (body.status) {
      const action = body.status === "APPROVED"
        ? "INTERVIEW_PLAN_APPROVED"
        : body.status === "REJECTED"
        ? "INTERVIEW_PLAN_REJECTED"
        : "INTERVIEW_PLAN_MODIFIED";

      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId,
        action,
        performedBy: session.uid,
        performedByName: actorName,
        targetId: id,
        details: { status: body.status, notes: body.principalNotes },
        timestamp: now,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[hiring-batches/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
