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
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN", "ACCOUNTS");
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId");
    const candidateId = searchParams.get("candidateId");

    if (!batchId) {
      return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    }

    const db = getAdminDb();
    let query = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("hiringBatches")
      .doc(batchId)
      .collection("hrFeedback") as FirebaseFirestore.Query;

    if (candidateId) {
      query = query.where("candidateId", "==", candidateId);
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
    console.error("[college/hr-feedback GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    // HOD acts as HR in this flow
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      batchId: string;
      candidateId: string;
      ratings: {
        attitude: number;
        teamwork: number;
        adaptability: number;
        communication: number;
        overallFit: number;
      };
      salaryExpectation?: number;
      noticePeriod?: string;
      recommendation: "ACCEPT" | "REJECT" | "MAYBE";
      comments?: string;
    };

    const { batchId, candidateId, ratings, recommendation } = body;
    if (!batchId || !candidateId || !ratings || !recommendation) {
      return NextResponse.json(
        { error: "batchId, candidateId, ratings, recommendation required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const hrName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    const feedbackCol = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("hiringBatches")
      .doc(batchId)
      .collection("hrFeedback");

    // Upsert: one HR feedback per candidate per batch
    const existingSnap = await feedbackCol
      .where("candidateId", "==", candidateId)
      .get();

    const payload = {
      collegeId: session.collegeId,
      batchId,
      candidateId,
      hrUid: session.uid,
      hrName,
      ratings,
      salaryExpectation: body.salaryExpectation ?? null,
      noticePeriod: body.noticePeriod ?? "",
      recommendation,
      comments: body.comments ?? "",
      submittedAt: now,
    };

    let docId: string;
    if (!existingSnap.empty) {
      await existingSnap.docs[0].ref.update(payload);
      docId = existingSnap.docs[0].id;
    } else {
      const ref = await feedbackCol.add(payload);
      docId = ref.id;
    }

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "FEEDBACK_SUBMITTED",
      performedBy: session.uid,
      performedByName: hrName,
      targetId: docId,
      details: { batchId, candidateId, type: "HR", recommendation },
      timestamp: now,
    });

    return NextResponse.json({ id: docId }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/hr-feedback POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
