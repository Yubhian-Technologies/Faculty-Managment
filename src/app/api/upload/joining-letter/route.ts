export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminStorage } from "@/lib/firebase/admin";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
};
const EXT_TO_EXT: Record<string, string> = { pdf: "pdf", png: "png", jpg: "jpg", jpeg: "jpg" };

// Office scans and uploads the candidate's manually-signed joining letter here -
// keyed by candidateId (not facultyId, unlike upload/faculty-document) since no
// faculty record exists yet at this point in the pipeline.
export async function POST(request: Request) {
  try {
    await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");

    const formData = await request.formData();
    const file = formData.get("file");
    const candidateId = formData.get("candidateId");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Select a file to upload." }, { status: 400 });
    }
    if (!candidateId || typeof candidateId !== "string") {
      return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
    }

    const fileExt = (file as File).name?.split(".").pop()?.toLowerCase() ?? "";
    const ext = MIME_TO_EXT[file.type] ?? EXT_TO_EXT[fileExt];
    if (!ext) {
      return NextResponse.json({ error: "Only PDF, PNG or JPEG files can be uploaded." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_SIZE) {
      return NextResponse.json({ error: "The file is larger than 10 MB. Upload a smaller file." }, { status: 400 });
    }

    const downloadToken = randomUUID();
    const path = `candidate-documents/${candidateId}/joining-letter/${randomUUID()}.${ext}`;
    const contentType = file.type || (ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg");

    const bucket = getAdminStorage().bucket();
    const fileRef = bucket.file(path);
    await fileRef.save(buffer, {
      metadata: { cacheControl: "public, max-age=604800", contentType, metadata: { firebaseStorageDownloadTokens: downloadToken } },
      resumable: false,
    });

    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`;
    return NextResponse.json({ url }, { status: 200 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[upload/joining-letter POST]", err);
    return NextResponse.json({ error: "Unable to upload the file. Try again." }, { status: 500 });
  }
}
