export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAdminDb, getAdminStorage } from "@/lib/firebase/admin";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

// GET — returns candidate name + required documents list
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getAdminDb();

    // Find the candidate across all colleges
    const collegesSnap = await db.collection("colleges").get();
    for (const college of collegesSnap.docs) {
      const candidateSnap = await college.ref.collection("candidates").doc(id).get();
      if (!candidateSnap.exists) continue;

      const candidate = candidateSnap.data() as {
        name?: string;
        position?: string;
        batchId?: string;
        submittedDocuments?: Record<string, { url: string; uploadedAt: string }>;
      };

      // Fetch required documents from the batch
      let requiredDocuments: string[] = [];
      if (candidate.batchId) {
        const batchSnap = await college.ref.collection("hiringBatches").doc(candidate.batchId).get();
        if (batchSnap.exists) {
          requiredDocuments = (batchSnap.data() as { requiredDocuments?: string[] }).requiredDocuments ?? [];
        }
      }

      return NextResponse.json({
        candidateName: candidate.name ?? "Candidate",
        position: candidate.position ?? "",
        requiredDocuments,
        submittedDocuments: candidate.submittedDocuments ?? {},
      });
    }

    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  } catch (err) {
    console.error("[public/candidate-docs GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// POST — upload a document for a specific type
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const formData = await request.formData();
    const file = formData.get("file");
    const docType = formData.get("docType");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!docType || typeof docType !== "string") {
      return NextResponse.json({ error: "docType required" }, { status: 400 });
    }
    if (!["application/pdf", "image/jpeg", "image/png"].includes((file as File).type)) {
      return NextResponse.json({ error: "Only PDF, JPG, or PNG files accepted" }, { status: 400 });
    }

    const buffer = Buffer.from(await (file as File).arrayBuffer());
    if (buffer.byteLength > MAX_SIZE) {
      return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegesSnap = await db.collection("colleges").get();

    for (const college of collegesSnap.docs) {
      const candidateRef = college.ref.collection("candidates").doc(id);
      const candidateSnap = await candidateRef.get();
      if (!candidateSnap.exists) continue;

      const downloadToken = randomUUID();
      const ext = (file as File).name.split(".").pop() ?? "pdf";
      const safeDocType = docType.replace(/[^a-zA-Z0-9_-]/g, "_");
      const path = `colleges/${college.id}/candidate-docs/${id}/${safeDocType}_${Date.now()}.${ext}`;

      const bucket = getAdminStorage().bucket();
      const fileRef = bucket.file(path);

      await fileRef.save(buffer, {
        metadata: {
          contentType: (file as File).type,
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
        resumable: false,
      });

      const encodedPath = encodeURIComponent(path);
      const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;

      // Save URL into candidate's submittedDocuments map
      await candidateRef.update({
        [`submittedDocuments.${safeDocType}`]: {
          label: docType,
          url,
          uploadedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      });

      return NextResponse.json({ url }, { status: 200 });
    }

    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  } catch (err) {
    console.error("[public/candidate-docs POST]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
