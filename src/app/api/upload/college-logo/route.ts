export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminStorage } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export async function POST(request: Request) {
  try {
    const session = await requireCollegeContext(
      request,
      "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"
    );

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No image file provided" }, { status: 400 });
    }

    const ext = ALLOWED_TYPES[file.type];
    if (!ext) {
      return NextResponse.json(
        { error: "Only PNG, JPEG, WEBP, or SVG images are supported" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_SIZE) {
      return NextResponse.json({ error: "Image exceeds 5 MB limit" }, { status: 400 });
    }

    const path = `colleges/${session.collegeId}/logo_${Date.now()}.${ext}`;
    const downloadToken = randomUUID();

    const bucket = getAdminStorage().bucket();
    const fileRef = bucket.file(path);

    await fileRef.save(buffer, {
      metadata: {
        contentType: file.type,
        cacheControl: "public, max-age=604800",
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
      resumable: false,
    });

    const encodedPath = encodeURIComponent(path);
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;

    // Automatically persist the new logo on the college document
    const db = getAdminDb();
    await db.collection("colleges").doc(session.collegeId).update({
      logoUrl: url,
      updatedAt: new Date(),
    });

    await writeAuditLogSafe(db, session.collegeId, {
      action: "COLLEGE_SETTINGS_UPDATED",
      performedBy: session.uid,
      targetId: session.collegeId,
      details: {
        field: "logoUrl",
        logoUrl: url,
      },
    });

    return NextResponse.json({ ok: true, url, logoUrl: url, hasCustomLogo: true }, { status: 200 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[upload/college-logo POST]", err);
    return NextResponse.json({ error: "Failed to upload logo" }, { status: 500 });
  }
}
