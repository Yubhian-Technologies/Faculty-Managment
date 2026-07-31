export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminStorage } from "@/lib/firebase/admin";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "application/pdf": "pdf",
};
const EXT_TO_EXT: Record<string, string> = {
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  pdf: "pdf",
};

export async function POST(request: Request) {
  try {
    const session = await requireRole(
      "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "PANEL_MEMBER",
      "COLLEGE_OFFICE", "ADMINISTRATION", "SUPER_ADMIN"
    );

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Prefer MIME type; fall back to filename extension when the multipart
    // Content-Type header is missing (happens in some Node.js/Next.js versions).
    const fileExt = (file as File).name?.split(".").pop()?.toLowerCase() ?? "";
    const ext = MIME_TO_EXT[file.type] ?? EXT_TO_EXT[fileExt];
    if (!ext) {
      return NextResponse.json({ error: "Only PNG, JPEG, or PDF files are accepted" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_SIZE) {
      return NextResponse.json({ error: "File exceeds 5 MB limit" }, { status: 400 });
    }

    const downloadToken = randomUUID();
    const path = `degree-certificates/${session.uid}/${randomUUID()}.${ext}`;

    const bucket = getAdminStorage().bucket();
    const fileRef = bucket.file(path);

    const contentType = file.type || (ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg");
    await fileRef.save(buffer, {
      metadata: {
        contentType,
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
      resumable: false,
    });

    const encodedPath = encodeURIComponent(path);
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;

    return NextResponse.json({ url }, { status: 200 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[upload/certificate POST]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
