export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminStorage } from "@/lib/firebase/admin";
import { CERTIFICATE_REQUESTS_COL } from "@/lib/certifications/transitions";
import type { CertificateRequest } from "@/types";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

// Only the issuer uploads here (the PDF is rendered client-side in their
// browser, then this route stores the bytes) - mirrors upload/leave-proof's
// shape: every path component comes from the session or the loaded request,
// never the client body, so the storage path is a meaningful ownership claim.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL");

    const formData = await request.formData();
    const file = formData.get("file");
    const requestId = formData.get("requestId");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!requestId || typeof requestId !== "string") {
      return NextResponse.json({ error: "requestId is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const snap = await CERTIFICATE_REQUESTS_COL(db, session.collegeId).doc(requestId).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Certificate request not found" }, { status: 404 });
    }
    const certRequest = { id: snap.id, ...snap.data() } as CertificateRequest;
    if (certRequest.status !== "PENDING_ISSUANCE") {
      return NextResponse.json({ error: "This request isn't ready for issuance" }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_SIZE) {
      return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 400 });
    }

    const downloadToken = randomUUID();
    const path = `certificates/${session.collegeId}/${requestId}/${randomUUID()}.pdf`;

    const bucket = getAdminStorage().bucket();
    await bucket.file(path).save(buffer, {
      metadata: { cacheControl: "public, max-age=604800", contentType: "application/pdf", metadata: { firebaseStorageDownloadTokens: downloadToken } },
      resumable: false,
    });

    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`;
    return NextResponse.json({ url }, { status: 200 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[upload/certificates POST]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
