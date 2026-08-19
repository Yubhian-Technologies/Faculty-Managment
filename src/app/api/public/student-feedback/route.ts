export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

// Public: lets the QR feedback page find out whether the demo is still open
// before showing the rating form (so it can close once demo is complete).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const collegeId = searchParams.get("collegeId");
  const batchId = searchParams.get("batchId");
  if (!collegeId || !batchId) {
    return NextResponse.json({ error: "collegeId and batchId are required" }, { status: 400 });
  }
  const snap = await getAdminDb()
    .collection("colleges").doc(collegeId)
    .collection("hiringBatches").doc(batchId)
    .get();
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ demoComplete: snap.get("demoComplete") === true });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      batchId: string;
      candidateId: string;
      collegeId: string;
      ratings: {
        clarity: number;
        engagement: number;
        knowledgeDepth: number;
        timeManagement: number;
        overallImpression: number;
      };
      comments?: string;
    };

    const { batchId, candidateId, collegeId, ratings } = body;

    if (!batchId || !candidateId || !collegeId) {
      return NextResponse.json({ error: "batchId, candidateId and collegeId are required" }, { status: 400 });
    }

    const allRated = Object.values(ratings).every((v) => typeof v === "number" && v >= 1 && v <= 5);
    if (!allRated) {
      return NextResponse.json({ error: "All ratings must be between 1 and 5" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();

    const batchRef = db.collection("colleges").doc(collegeId).collection("hiringBatches").doc(batchId);
    const batchSnap = await batchRef.get();
    if (!batchSnap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (batchSnap.get("demoComplete") === true) {
      return NextResponse.json({ error: "Demo class is complete; feedback is closed." }, { status: 403 });
    }

    // The QR link is public by design (no student login), so this is the only
    // check standing between "feedback for the candidate who actually demoed"
    // and anyone who can guess/alter a candidateId in the URL.
    const membershipSnap = await db
      .collection("colleges").doc(collegeId)
      .collection("candidateApplications")
      .where("batchId", "==", batchId)
      .where("candidateId", "==", candidateId)
      .limit(1)
      .get();
    if (membershipSnap.empty) {
      return NextResponse.json({ error: "Candidate is not part of this batch" }, { status: 400 });
    }

    await batchRef
      .collection("studentFeedback")
      .add({
        collegeId,
        batchId,
        candidateId,
        ratings,
        comments: body.comments ?? "",
        submittedAt: now,
      });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("[public/student-feedback POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
