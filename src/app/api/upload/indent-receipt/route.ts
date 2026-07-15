export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminStorage } from "@/lib/firebase/admin";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PURCHASE_DEPT", "SUPER_ADMIN");

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Only PDF, JPEG, or PNG files are accepted" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_SIZE) {
      return NextResponse.json({ error: "File exceeds 5 MB limit" }, { status: 400 });
    }

    const filename = `${Date.now()}_${(file as File).name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const path = `colleges/${session.collegeId}/indentReceipts/${filename}`;

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

    return NextResponse.json({ url, filename: (file as File).name }, { status: 200 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[upload/indent-receipt POST]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
