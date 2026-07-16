export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminStorage } from "@/lib/firebase/admin";

const MAX_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

export async function POST(request: Request) {
  try {
    // Covers self-service uploads (own dashboard) as well as admin-driven uploads
    // (Principal/HOD/Administration/Super Admin uploading on behalf of someone they
    // manage) — who may write the resulting URL to which document is enforced
    // separately by the PATCH route that persists it. No collegeId requirement here
    // since Super Admin sessions have none.
    const session = await requireRole(
      "PRINCIPAL",
      "VICE_PRINCIPAL",
      "HOD",
      "PANEL_MEMBER",
      "COLLEGE_OFFICE",
      "ACCOUNTS",
      "FINANCE",
      "PURCHASE_DEPT",
      "ADMINISTRATION",
      "SUPER_ADMIN"
    );

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const ext = ALLOWED_TYPES[file.type];
    if (!ext) {
      return NextResponse.json({ error: "Only PNG or JPEG images are accepted" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_SIZE) {
      return NextResponse.json({ error: "Image exceeds 2 MB limit" }, { status: 400 });
    }

    // `targetId` lets Principal/HOD upload a photo on behalf of a HOD, Vice Principal, or
    // faculty record they manage — the write itself is authorized separately when the
    // returned URL is persisted via the college/users or college/faculty PATCH routes.
    const rawTargetId = formData.get("targetId");
    const targetId = typeof rawTargetId === "string" ? rawTargetId.replace(/[^a-zA-Z0-9_-]/g, "") : "";
    const id = targetId || session.uid;

    const path = `profile-photos/${id}_${Date.now()}.${ext}`;

    // Generate a download token — this is how Firebase Storage client SDK creates
    // permanent public-readable URLs without requiring any ACL changes or UBLA workarounds.
    const downloadToken = randomUUID();

    const bucket = getAdminStorage().bucket();
    const fileRef = bucket.file(path);

    await fileRef.save(buffer, {
      metadata: {
        contentType: file.type,
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
    console.error("[upload/profile-photo POST]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
