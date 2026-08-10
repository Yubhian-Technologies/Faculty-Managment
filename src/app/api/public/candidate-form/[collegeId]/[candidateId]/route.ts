export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Candidate, CandidateApplication, CandidateBioData, HiringBatch } from "@/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ collegeId: string; candidateId: string }> }
) {
  try {
    const { collegeId, candidateId } = await params;
    const { searchParams } = new URL(request.url);
    const applicationId = searchParams.get("applicationId");
    if (!applicationId) {
      return NextResponse.json({ error: "applicationId required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(collegeId);
    const [candidateSnap, applicationSnap] = await Promise.all([
      collegeRef.collection("candidates").doc(candidateId).get(),
      collegeRef.collection("candidateApplications").doc(applicationId).get(),
    ]);

    if (!candidateSnap.exists || !applicationSnap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const candidateData = candidateSnap.data() as Candidate;
    const applicationData = applicationSnap.data() as CandidateApplication;
    if (applicationData.candidateId !== candidateId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let requiredDocuments: string[] = [];
    if (applicationData.batchId) {
      const batchSnap = await collegeRef.collection("hiringBatches").doc(applicationData.batchId).get();
      requiredDocuments = (batchSnap.data() as HiringBatch | undefined)?.requiredDocuments ?? [];
    }

    return NextResponse.json({
      candidate: {
        name: candidateData.name,
        position: applicationData.position,
        department: applicationData.department,
        bioDataSubmitted: candidateData.bioDataSubmitted ?? false,
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
