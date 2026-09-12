export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminStorage } from "@/lib/firebase/admin";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB - matches DocumentUploadField's own cap
const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
};
const EXT_TO_EXT: Record<string, string> = { pdf: "pdf", png: "png", jpg: "jpg", jpeg: "jpg" };

// Screenshot of YUKTI Status - same pattern as /api/upload/consultancy-doc.
const KINDS = ["yukti-screenshot"] as const;

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...PUBLICATION_ELIGIBLE_ROLES);

    const formData = await request.formData();
    const file = formData.get("file");
    const kindRaw = formData.get("kind");
    const kind = KINDS.includes(kindRaw as (typeof KINDS)[number]) ? (kindRaw as (typeof KINDS)[number]) : "other";

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
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
    const path = `innovation-docs/${session.collegeId}/${session.uid}/${kind}/${randomUUID()}.${ext}`;
    const contentType = file.type || (ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg");

    const bucket = getAdminStorage().bucket();
    await bucket.file(path).save(buffer, {
      metadata: { contentType, metadata: { firebaseStorageDownloadTokens: downloadToken } },
      resumable: false,
    });

    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`;
    return NextResponse.json({ url }, { status: 200 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[upload/innovation-doc POST]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
