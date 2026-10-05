export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminStorage } from "@/lib/firebase/admin";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
// Matches DocumentUploadField's own hardcoded accept="" exactly - that
// shared component (used as-is, unmodified) is what actually gates file
// selection in the browser, so this route's own allowlist must match it or
// the two disagree about what's acceptable.
const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
};
const EXT_TO_EXT: Record<string, string> = { pdf: "pdf", png: "png", jpg: "jpg", jpeg: "jpg" };

export async function POST(request: Request) {
  try {
    await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");

    const formData = await request.formData();
    const file = formData.get("file");
    const catalogId = formData.get("catalogId");
    const regulation = formData.get("regulation");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!catalogId || typeof catalogId !== "string") {
      return NextResponse.json({ error: "catalogId is required" }, { status: 400 });
    }
    if (!regulation || typeof regulation !== "string") {
      return NextResponse.json({ error: "regulation is required" }, { status: 400 });
    }

    const fileExt = (file as File).name?.split(".").pop()?.toLowerCase() ?? "";
    const ext = MIME_TO_EXT[file.type] ?? EXT_TO_EXT[fileExt];
    if (!ext) {
      return NextResponse.json({ error: "Only PDF, PNG, or JPEG files are accepted" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_SIZE) {
      return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 400 });
    }

    const downloadToken = randomUUID();
    const path = `regulation-documents/${catalogId}/${regulation}/${randomUUID()}.${ext}`;
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[upload/regulation-document POST]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
