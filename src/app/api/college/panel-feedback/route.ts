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
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN", "PANEL_MEMBER");
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId");
    const candidateId = searchParams.get("candidateId");

    if (!batchId) {
      return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    }

    const db = getAdminDb();

    // Build query without orderBy to avoid composite-index requirements.
    // Sorting is done in-memory; panelFeedback is a small subcollection.
    let query = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("hiringBatches")
      .doc(batchId)
      .collection("panelFeedback") as FirebaseFirestore.Query;

    if (candidateId) {
      query = query.where("candidateId", "==", candidateId);
    }

    // Panel members only see their own submissions
    if (session.role === "PANEL_MEMBER") {
      query = query.where("panelUid", "==", session.uid);
    }

    const snap = await query.get();
    const feedback = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = (a as { submittedAt?: { toMillis?: () => number } }).submittedAt?.toMillis?.() ?? 0;
        const tb = (b as { submittedAt?: { toMillis?: () => number } }).submittedAt?.toMillis?.() ?? 0;
        return tb - ta;
      });

    return NextResponse.json({ feedback });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/panel-feedback GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN");
    const body = (await request.json()) as {
      batchId: string;
      candidateId: string;
      // Demo-day module
      demoRatings?: {
        planningAndOrganizing: string;
        effectiveUseOfTime: string;
        communicativeAbility: string;
        ensuringStudentAttention: string;
        chalkBoardWork: string;
        studentParticipation: string;
      };
      demoOverallScore?: number;
      demoComments?: string;
      // Panel-interview module
      ratings?: {
        technicalKnowledge: number;
        communicationSkills: number;
        teachingMethodology: number;
      };
      remarksByCategory?: {
        subjectKnowledge?: string;
        communication?: string;
        presentationSkills?: string;
        research?: string;
        specificAttributes?: string;
        others?: string;
      };
      subjectsTested?: string[];
      salaryNegotiated?: number;
      noticePeriod?: string;
      strengths?: string;
      weaknesses?: string;
      recommendation?: "ACCEPT" | "REJECT" | "MAYBE";
      comments?: string;
    };

    const { batchId, candidateId, demoRatings, demoOverallScore, ratings, recommendation } = body;
    const hasDemo = !!demoRatings && demoOverallScore != null;
    const hasInterview = !!ratings && !!recommendation;
    if (!batchId || !candidateId || (!hasDemo && !hasInterview)) {
      return NextResponse.json(
        { error: "batchId, candidateId, and either demoRatings+demoOverallScore or ratings+recommendation are required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const panelName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    const feedbackCol = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("hiringBatches")
      .doc(batchId)
      .collection("panelFeedback");

    // Upsert: one doc per panel member per candidate, shared across the demo
    // and panel-interview modules — a later submission merges in rather than
    // overwriting whichever module was already saved.
    const existingSnap = await feedbackCol
      .where("candidateId", "==", candidateId)
      .where("panelUid", "==", session.uid)
      .get();

    const payload: Record<string, unknown> = {
      collegeId: session.collegeId,
      batchId,
      candidateId,
      panelUid: session.uid,
      panelName,
      updatedAt: now,
    };
    if (hasDemo) {
      payload.demoRatings = demoRatings;
      payload.demoOverallScore = demoOverallScore;
      payload.demoComments = body.demoComments ?? "";
    }
    if (hasInterview) {
      payload.ratings = ratings;
      payload.recommendation = recommendation;
      payload.remarksByCategory = body.remarksByCategory ?? {};
      payload.subjectsTested = body.subjectsTested ?? [];
      if (body.salaryNegotiated != null) payload.salaryNegotiated = body.salaryNegotiated;
      payload.noticePeriod = body.noticePeriod ?? "";
      payload.strengths = body.strengths ?? "";
      payload.weaknesses = body.weaknesses ?? "";
      payload.comments = body.comments ?? "";
    }

    let docId: string;
    if (!existingSnap.empty) {
      await existingSnap.docs[0].ref.set(payload, { merge: true });
      docId = existingSnap.docs[0].id;
    } else {
      const ref = await feedbackCol.add({ ...payload, submittedAt: now });
      docId = ref.id;
    }

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "FEEDBACK_SUBMITTED",
      performedBy: session.uid,
      performedByName: panelName,
      targetId: docId,
      details: { batchId, candidateId, module: hasDemo ? "DEMO" : "PANEL_INTERVIEW", ...(recommendation ? { recommendation } : {}) },
      timestamp: now,
    });

    return NextResponse.json({ id: docId }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/panel-feedback POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
