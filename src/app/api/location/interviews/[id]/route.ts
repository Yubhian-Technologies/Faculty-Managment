export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const session = await verifySession();
    const allowed = ["SUPER_ADMIN", "ADMINISTRATION", "HR_ADMIN", "LOCATION_DEPT_HEAD"];
    if (!session || !allowed.includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.locationId) return NextResponse.json({ error: "No location context" }, { status: 400 });

    const db = getAdminDb();
    const doc = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationInterviews")
      .doc(id)
      .get();

    if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Fetch feedback
    const feedbackSnap = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationInterviews")
      .doc(id)
      .collection("feedback")
      .orderBy("submittedAt", "desc")
      .get();

    const feedback = feedbackSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ interview: { id: doc.id, ...doc.data() }, feedback });
  } catch (err) {
    console.error("[location/interviews/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const session = await verifySession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session.locationId) return NextResponse.json({ error: "No location context" }, { status: 400 });

    const body = (await request.json()) as {
      action?: "APPROVE" | "REJECT" | "SUBMIT_FEEDBACK" | "MARK_COMPLETE" | "SEND_CALL_LETTERS";
      reason?: string;
      // feedback fields
      candidateId?: string;
      candidateName?: string;
      technicalScore?: number;
      communicationScore?: number;
      remarks?: string;
      recommendation?: "SELECTED" | "REJECTED" | "WAITLISTED";
    };

    const db = getAdminDb();
    const ref = db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationInterviews")
      .doc(id);

    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Interview not found" }, { status: 404 });

    const interview = snap.data() as {
      status: string;
      title: string;
      createdByUid: string;
      panelMembers: { uid: string; name: string; role: string }[];
      shortlistedCandidateIds: string[];
      candidatesInfo: { id: string; name: string }[];
    };
    const now = new Date();

    // ── Administration: approve or reject ────────────────────────────────────
    if (body.action === "APPROVE" || body.action === "REJECT") {
      if (session.role !== "ADMINISTRATION") {
        return NextResponse.json({ error: "Only Administration can approve/reject interview plans" }, { status: 403 });
      }
      if (interview.status !== "PENDING_ADMIN") {
        return NextResponse.json({ error: "Interview plan is not pending admin approval" }, { status: 400 });
      }

      const newStatus = body.action === "APPROVE" ? "APPROVED" : "REJECTED";
      const approverSnap = await db.collection("locations").doc(session.locationId).collection("locationUsers").doc(session.uid).get();
      const approverName = (approverSnap.data() as { name?: string })?.name ?? session.email;

      await ref.update({
        status: newStatus,
        approvedByUid: session.uid,
        approvedByName: approverName,
        rejectionReason: body.reason ?? "",
        updatedAt: now,
      });

      // Notify HR Admin
      const hrSnap = await db
        .collection("locations")
        .doc(session.locationId)
        .collection("locationUsers")
        .where("role", "==", "HR_ADMIN")
        .get();

      const batch = db.batch();
      hrSnap.docs.forEach((d) => {
        const notifRef = db.collection("locations").doc(session.locationId!).collection("locationNotifications").doc();
        batch.set(notifRef, {
          toUid: d.id,
          locationId: session.locationId,
          type: newStatus === "APPROVED" ? "INTERVIEW_PLAN_APPROVED" : "INTERVIEW_PLAN_REJECTED",
          title: newStatus === "APPROVED" ? "Interview Plan Approved" : "Interview Plan Rejected",
          message: `Administration has ${newStatus === "APPROVED" ? "approved" : "rejected"} the interview plan: "${interview.title}".`,
          link: `/hr-admin/interviews/${id}`,
          read: false,
          createdAt: now,
        });
      });
      await batch.commit();

      return NextResponse.json({ ok: true, status: newStatus });
    }

    // ── HR Admin: send call letters after approval ───────────────────────────
    if (body.action === "SEND_CALL_LETTERS") {
      if (session.role !== "HR_ADMIN") {
        return NextResponse.json({ error: "Only HR Admin can send call letters" }, { status: 403 });
      }
      if (interview.status !== "APPROVED") {
        return NextResponse.json({ error: "Interview must be approved before sending call letters" }, { status: 400 });
      }

      // Mark candidates as having received call letter
      const candidateBatch = db.batch();
      interview.shortlistedCandidateIds.forEach((cid) => {
        const cRef = db
          .collection("locations")
          .doc(session.locationId!)
          .collection("locationCandidates")
          .doc(cid);
        candidateBatch.update(cRef, { callLetterSent: true, interviewId: id, updatedAt: now });
      });

      // Mark panel members (notify them)
      interview.panelMembers.forEach((pm) => {
        const notifRef = db.collection("locations").doc(session.locationId!).collection("locationNotifications").doc();
        candidateBatch.set(notifRef, {
          toUid: pm.uid,
          locationId: session.locationId,
          type: "INTERVIEW_PLAN_APPROVED",
          title: "Interview Assignment",
          message: `You have been assigned as a panel member for: "${interview.title}". Please log in to view details.`,
          link: `/location-dept-head/interviews/${id}`,
          read: false,
          createdAt: now,
        });
      });

      await candidateBatch.commit();
      await ref.update({ callLetterSent: true, updatedAt: now });

      return NextResponse.json({ ok: true });
    }

    // ── Panel members: submit feedback ──────────────────────────────────────
    if (body.action === "SUBMIT_FEEDBACK") {
      const panelRoles = ["ADMINISTRATION", "HR_ADMIN", "LOCATION_DEPT_HEAD"];
      if (!panelRoles.includes(session.role)) {
        return NextResponse.json({ error: "Only panel members can submit feedback" }, { status: 403 });
      }
      if (interview.status !== "APPROVED" && interview.status !== "COMPLETED") {
        return NextResponse.json({ error: "Interview must be approved to submit feedback" }, { status: 400 });
      }
      if (!body.candidateId || body.technicalScore == null || body.communicationScore == null || !body.recommendation) {
        return NextResponse.json({ error: "candidateId, technicalScore, communicationScore, recommendation are required" }, { status: 400 });
      }

      // Check for duplicate feedback
      const existingFeedback = await ref
        .collection("feedback")
        .where("panelUid", "==", session.uid)
        .where("candidateId", "==", body.candidateId)
        .limit(1)
        .get();

      if (!existingFeedback.empty) {
        // Update existing feedback
        await existingFeedback.docs[0].ref.update({
          technicalScore: body.technicalScore,
          communicationScore: body.communicationScore,
          remarks: body.remarks ?? "",
          recommendation: body.recommendation,
          submittedAt: now,
        });
      } else {
        const panelSnap = await db.collection("locations").doc(session.locationId).collection("locationUsers").doc(session.uid).get();
      const panelName = (panelSnap.data() as { name?: string })?.name ?? session.email;

      await ref.collection("feedback").add({
          interviewId: id,
          locationId: session.locationId,
          panelUid: session.uid,
          panelName,
          panelRole: session.role,
          candidateId: body.candidateId,
          candidateName: body.candidateName ?? "",
          technicalScore: body.technicalScore,
          communicationScore: body.communicationScore,
          remarks: body.remarks ?? "",
          recommendation: body.recommendation,
          submittedAt: now,
        });
      }

      return NextResponse.json({ ok: true });
    }

    // ── HR Admin: mark interview complete ───────────────────────────────────
    if (body.action === "MARK_COMPLETE") {
      if (session.role !== "HR_ADMIN") {
        return NextResponse.json({ error: "Only HR Admin can mark interview as complete" }, { status: 403 });
      }
      await ref.update({ status: "COMPLETED", completedAt: now, updatedAt: now });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "No valid action provided" }, { status: 400 });
  } catch (err) {
    console.error("[location/interviews/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
