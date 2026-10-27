export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminStorage } from "@/lib/firebase/admin";
import { bankAccess, guardError, MID_BANK_WRITE_ROLES } from "@/lib/midBank/server";
import { imageKind, imageSize } from "@/lib/midBank/imageSize";
import { LIMITS } from "@/lib/midBank/constants";

// An image for a Mid question (a diagram, a circuit). Only the faculty holding
// the bank may upload; the bytes must really be PNG or JPEG (the claimed type
// is not trusted), at most 1 MB and within the size limits. The path is scoped
// to the bank, never to a client-supplied file name.

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...MID_BANK_WRITE_ROLES);
    let form: FormData;
    try { form = await request.formData(); } catch { return NextResponse.json({ error: "Send the image as multipart form data" }, { status: 400 }); }
    const bankId = String(form.get("bankId") ?? "");
    const file = form.get("file");
    if (!bankId) return NextResponse.json({ error: "bankId is required" }, { status: 400 });
    if (!file || typeof file === "string") return NextResponse.json({ error: "No image provided" }, { status: 400 });

    const access = await bankAccess(getAdminDb(), session, bankId);
    if (!access) return NextResponse.json({ error: "Question bank not found" }, { status: 404 });
    if (!access.canWrite) return NextResponse.json({ error: access.isOwner ? "The deadline has passed - this question bank is locked" : "Only the faculty preparing this question bank can add images" }, { status: 403 });

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength === 0) return NextResponse.json({ error: "The image is empty" }, { status: 400 });
    if (buffer.byteLength > LIMITS.imageBytes) return NextResponse.json({ error: "The image must be 1 MB or smaller" }, { status: 400 });
    const kind = imageKind(buffer);
    if (!kind) return NextResponse.json({ error: "Only PNG or JPEG images are accepted" }, { status: 400 });
    const size = imageSize(buffer);
    if (!size) return NextResponse.json({ error: "The image could not be read" }, { status: 400 });
    if (Math.max(size.width, size.height) > LIMITS.imageMaxSide || Math.min(size.width, size.height) < LIMITS.imageMinSide) {
      return NextResponse.json({ error: `The image must be between ${LIMITS.imageMinSide} and ${LIMITS.imageMaxSide} pixels on each side (this one is ${size.width} x ${size.height})` }, { status: 400 });
    }

    const contentType = kind === "png" ? "image/png" : "image/jpeg";
    const token = randomUUID();
    const path = `mid-question-images/${session.collegeId}/${bankId}/${randomUUID()}.${kind}`;
    const bucket = getAdminStorage().bucket();
    await bucket.file(path).save(buffer, { metadata: { cacheControl: "public, max-age=604800", contentType, metadata: { firebaseStorageDownloadTokens: token } }, resumable: false });
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return NextResponse.json({ url, width: size.width, height: size.height });
  } catch (err) {
    return guardError(err, "[upload/mid-question-image POST]");
  }
}
