export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Candidate, CandidateBioData, HiringBatch } from "@/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collegeId: string; candidateId: string }> }
) {
  try {
    const { collegeId, candidateId } = await params;
    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(collegeId)
      .collection("candidates")
      .doc(candidateId)
      .get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const data = snap.data() as Candidate;

    let requiredDocuments: string[] = [];
    if (data.batchId) {
      const batchSnap = await db
        .collection("colleges")
        .doc(collegeId)
        .collection("hiringBatches")
        .doc(data.batchId)
        .get();
      requiredDocuments = (batchSnap.data() as HiringBatch | undefined)?.requiredDocuments ?? [];
    }

    return NextResponse.json({
      candidate: {
        name: data.name,
        position: data.position,
        department: data.department,
        bioDataSubmitted: data.bioDataSubmitted ?? false,
      },
      requiredDocuments,
    });
  } catch (err) {
    console.error("[public/candidate-form GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ collegeId: string; candidateId: string }> }
) {
  try {
    const { collegeId, candidateId } = await params;
    const body = (await request.json()) as {
      bioData?: CandidateBioData;
      certificates?: Array<{ name: string; url: string }>;
    };

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(collegeId).collection("candidates").doc(candidateId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const now = new Date();
    await ref.update({
      bioData: body.bioData ?? {},
      certificates: body.certificates ?? [],
      bioDataSubmitted: true,
      bioDataSubmittedAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[public/candidate-form PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
