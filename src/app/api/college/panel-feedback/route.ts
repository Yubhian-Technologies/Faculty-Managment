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
      // Panel evaluation module (marks out of 10 per criterion) — the active form
      panelScores?: {
        subjectKnowledge: number;
        presentationSkills: number;
        research: number;
        specificAttributes: number;
        others: number;
      };
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

    const { batchId, candidateId, demoRatings, demoOverallScore, panelScores, ratings, recommendation } = body;
    const hasDemo = !!demoRatings && demoOverallScore != null;
    const hasPanel = !!panelScores;
    const hasInterview = !!ratings && !!recommendation;
    if (!batchId || !candidateId || (!hasDemo && !hasPanel && !hasInterview)) {
      return NextResponse.json(
        { error: "batchId, candidateId, and one of panelScores / demoRatings+demoOverallScore / ratings+recommendation are required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const panelName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    const batchRef = collegeRef.collection("hiringBatches").doc(batchId);
    const batchSnap = await batchRef.get();
    if (!batchSnap.exists) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }
    const batch = batchSnap.data() as { panelMemberUids?: string[]; applicationIds?: string[]; currentPhase?: string };

    // Only an assigned panelist for this exact batch may score it - the UI
    // already hides the form for anyone else, but nothing previously stopped
    // a direct POST for a batch/candidate the caller isn't assigned to.
    if (session.role !== "SUPER_ADMIN" && !(batch.panelMemberUids ?? []).includes(session.uid)) {
      return NextResponse.json({ error: "You are not a panel member for this batch" }, { status: 403 });
    }

    // candidateId must resolve to one of this batch's own applications -
    // applicationIds stores CandidateApplication ids, not candidate ids.
    const applicationIds = batch.applicationIds ?? [];
    if (applicationIds.length === 0) {
      return NextResponse.json({ error: "This batch has no candidates" }, { status: 400 });
    }
    const applicationSnaps = await Promise.all(applicationIds.map((aid) => collegeRef.collection("candidateApplications").doc(aid).get()));
    const belongsToBatch = applicationSnaps.some((s) => s.exists && (s.data() as { candidateId?: string }).candidateId === candidateId);
    if (!belongsToBatch) {
      return NextResponse.json({ error: "This candidate is not part of this batch" }, { status: 400 });
    }

    // Mirrors evaluation/[batchId]/[candidateId]/page.tsx's own canScore gate -
    // the demo rubric is the only scoring form, open only once the HOD opens
    // panel scoring (PANEL_INTERVIEW) through final review — not while the demo
    // itself is still in progress (IN_PROGRESS).
    if ((hasDemo || hasPanel) && !["PANEL_INTERVIEW", "PRINCIPAL_FINAL_REVIEW", "COMPLETED"].includes(batch.currentPhase ?? "")) {
      return NextResponse.json({ error: "Evaluation is not open for this batch right now" }, { status: 409 });
    }
    if (hasInterview && !["PANEL_INTERVIEW", "PRINCIPAL_FINAL_REVIEW", "COMPLETED"].includes(batch.currentPhase ?? "")) {
      return NextResponse.json({ error: "Interview scoring is not open for this batch right now" }, { status: 409 });
    }

    const feedbackCol = batchRef.collection("panelFeedback");

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
    if (hasPanel) {
      payload.panelScores = panelScores;
      payload.strengths = body.strengths ?? "";
      payload.weaknesses = body.weaknesses ?? "";
      payload.comments = body.comments ?? "";
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

    // Upsert: one doc per panel member per candidate, shared across the demo
    // and panel-interview modules - a later submission merges in rather than
    // overwriting whichever module was already saved. Run as a transaction so
    // two near-simultaneous submissions from the same panelist can't both miss
    // the existing-doc read and create duplicate feedback docs (which would
    // double-count in the accept/reject tally).
    const docId = await db.runTransaction(async (tx) => {
      const existingSnap = await tx.get(
        feedbackCol.where("candidateId", "==", candidateId).where("panelUid", "==", session.uid)
      );
      if (!existingSnap.empty) {
        tx.set(existingSnap.docs[0].ref, payload, { merge: true });
        return existingSnap.docs[0].id;
      }
      const newRef = feedbackCol.doc();
      tx.set(newRef, { ...payload, submittedAt: now });
      return newRef.id;
    });

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "FEEDBACK_SUBMITTED",
      performedBy: session.uid,
      performedByName: panelName,
      targetId: docId,
      details: { batchId, candidateId, module: hasPanel ? "PANEL_EVALUATION" : hasDemo ? "DEMO" : "PANEL_INTERVIEW", ...(recommendation ? { recommendation } : {}) },
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
