export const dynamic = "force-dynamic";

import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { findUsersSnapshot } from "@/lib/roles/findUsersByRoles";
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
      "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER", "ACCOUNTS", "COLLEGE_ACCOUNTS", "HR"
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
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/hiring-batches GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "SUPER_ADMIN", "HR");
    const body = (await readJsonBody(request)) as {
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
    const actorName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const vacancySnap = await collegeRef.collection("vacancyRequests").doc(vacancyId).get();
    const vacancyData = vacancySnap.data() as { positionCategory?: string; status?: string; hodUid?: string; hodName?: string; department?: string; position?: string } | undefined;
    const positionCategory = vacancyData?.positionCategory ?? "TEACHING";

    // HR schedules on behalf of the department: the batch belongs to the HOD who raised the request (the HOD's pages,
    // final setup and phase steps all key on `hodUid`), HR is recorded as the one who scheduled it. The request must be
    // approved, the HOD must sit on the panel, and every candidate must be a shortlisted applicant of that request.
    const byHr = session.role === "HR";
    if (byHr) {
      if (!vacancySnap.exists || vacancyData?.status !== "APPROVED") {
        return NextResponse.json({ error: "Interviews can be scheduled only for an approved hiring request." }, { status: 409 });
      }
      if (!vacancyData?.hodUid) {
        return NextResponse.json({ error: "This hiring request has no HOD on record. Ask the Principal to check it." }, { status: 409 });
      }
      if (!panelMemberUids.includes(vacancyData.hodUid)) {
        return NextResponse.json({ error: "The department's HOD must be on the interview panel." }, { status: 400 });
      }
      if (panelMemberUids.length < 2) {
        return NextResponse.json({ error: "Select at least 2 panel members." }, { status: 400 });
      }
    }
    const hodUid = byHr ? vacancyData!.hodUid! : session.uid;
    const hodName = byHr ? (vacancyData?.hodName || await getUserName(db, session.collegeId, hodUid)) : actorName;

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
          const app = appSnaps[i].data() as { batchId?: string; vacancyRequestId?: string; isShortlisted?: boolean; status?: string };
          if (app.batchId) {
            throw new Error(`ALREADY_BATCHED:${applicationIds[i]}`);
          }
          if (byHr && (app.vacancyRequestId !== vacancyId || !app.isShortlisted || app.status === "APPROVED" || app.status === "REJECTED")) {
            throw new Error(`NOT_SHORTLISTED:${applicationIds[i]}`);
          }
        }

        tx.set(batchRef, {
          collegeId: session.collegeId,
          vacancyId,
          department,
          position,
          hodUid,
          hodName,
          ...(byHr ? { scheduledByUid: session.uid, scheduledByName: actorName, scheduledByRole: "HR" } : {}),
          positionCategory,
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
      if (txErr instanceof Error && txErr.message.startsWith("NOT_SHORTLISTED:")) {
        return NextResponse.json({ error: "Every candidate must be shortlisted for this hiring request." }, { status: 409 });
      }
      if (txErr instanceof Error && txErr.message.startsWith("APPLICATION_NOT_FOUND:")) {
        return NextResponse.json({ error: "One or more selected candidates could not be found" }, { status: 404 });
      }
      throw txErr;
    }

    const ref = batchRef;

    // Notify Principal and Vice Principal (both can decide the proposal) and
    // College Admin, who mirrors Principal's authority
    const principalsSnap = await findUsersSnapshot(db, session.collegeId, ["PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_ADMIN"]);
    // Scheduled by HR: the HOD is told too (they set up the demo room and coordinator once the Principal approves).
    if (byHr) {
      await db.collection("colleges").doc(session.collegeId).collection("notifications").add({
        collegeId: session.collegeId, toUid: hodUid, type: "GENERAL", title: "Interview Scheduled by HR",
        message: `${actorName} (HR) scheduled the interview for ${position} on ${interviewDate}. It goes to the Principal for approval; then set up the demo room and coordinator.`,
        link: "/hod/batches", read: false, createdAt: now,
      });
    }

    const notifBatch = db.batch();
    for (const p of principalsSnap.docs) {
      const notifRef = db.collection("colleges").doc(session.collegeId).collection("notifications").doc();
      notifBatch.set(notifRef, {
        collegeId: session.collegeId,
        toUid: p.id,
        type: "GENERAL",
        title: "Interview Panel Proposal",
        message: byHr
          ? `${actorName} (HR) scheduled an interview for ${position} in ${department} - approve the panel and plan.`
          : `${hodName} submitted an interview panel proposal for ${position} in ${department}.`,
        link: `/principal/interviews`,
        read: false,
        createdAt: now,
      });
    }
    await notifBatch.commit();

    await writeAuditLogSafe(db, session.collegeId, { action: "HIRING_BATCH_CREATED", performedBy: session.uid, performedByName: actorName, targetId: ref.id, details: { position, department, candidateCount: applicationIds.length, ...(byHr ? { scheduledBy: "HR", hodName } : {}) } });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/hiring-batches POST]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
