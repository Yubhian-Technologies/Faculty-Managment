export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminStorage } from "@/lib/firebase/admin";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN");
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
    const candidateRef = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("candidates")
      .doc(id);

    const candidateSnap = await candidateRef.get();
    if (!candidateSnap.exists) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    const downloadToken = randomUUID();
    const ext = (file as File).name.split(".").pop() ?? "pdf";
    const safeDocType = docType.replace(/[^a-zA-Z0-9_-]/g, "_");
    const path = `colleges/${session.collegeId}/candidate-docs/${id}/${safeDocType}_${Date.now()}.${ext}`;

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

    await candidateRef.update({
      [`submittedDocuments.${safeDocType}`]: {
        label: docType,
        url,
        uploadedAt: new Date().toISOString(),
        uploadedBy: "office",
      },
      updatedAt: new Date(),
    });

    return NextResponse.json({ url, safeKey: safeDocType }, { status: 200 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[candidates/[id]/upload-doc POST]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
