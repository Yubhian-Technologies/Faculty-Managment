export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

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

    await db
      .collection("colleges")
      .doc(collegeId)
      .collection("hiringBatches")
      .doc(batchId)
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
