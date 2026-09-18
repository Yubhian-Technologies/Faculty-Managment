export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminStorage } from "@/lib/firebase/admin";
import { REQUESTS_COL } from "@/lib/leave/balanceEngine";
import { evaluateODProof } from "@/lib/leave/odProof";
import type { LeaveRequest } from "@/types/leave";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB - matches DocumentUploadField's own cap

const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
};
const EXT_TO_EXT: Record<string, string> = { pdf: "pdf", png: "png", jpg: "jpg", jpeg: "jpg" };

// Proof of duty for an approved On Duty leave (see lib/leave/odProof.ts).
//
// Unlike the other upload routes this one is callable by EVERY role that can
// apply for leave, not just HOD and above - so it can't do what
// upload/faculty-document does and trust a client-supplied id to build the
// storage path. Every component of the path here comes from the session or the
// leave request loaded from Firestore, never from the body. That is what makes
// the path prefix a meaningful ownership claim, and lets SUBMIT_OD_PROOF
// verify the returned URL really belongs to this user and this request.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );

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
    const snap = await REQUESTS_COL(session.collegeId, db).doc(requestId).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Leave request not found" }, { status: 404 });
    }
    const leaveRequest = { id: snap.id, ...snap.data() } as LeaveRequest;

    if (leaveRequest.uid !== session.uid) {
      return NextResponse.json({ error: "You can only upload proof for your own leave" }, { status: 403 });
    }
    // One call covers "is an OD", "is approved", "carries the proof
    // obligation", "the period has ended" and "isn't already verified" - and
    // guarantees this endpoint and the SUBMIT_OD_PROOF action can never
    // disagree about whether an upload is allowed.
    if (!evaluateODProof(leaveRequest).canUpload) {
      return NextResponse.json(
        { error: "This leave request isn't awaiting proof of duty" },
        { status: 400 }
      );
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
    const path = `leave-proofs/${session.collegeId}/${session.uid}/${requestId}/${randomUUID()}.${ext}`;
    const contentType = file.type || (ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg");

    const bucket = getAdminStorage().bucket();
    await bucket.file(path).save(buffer, {
      metadata: { contentType, metadata: { firebaseStorageDownloadTokens: downloadToken } },
      resumable: false,
    });

    // Returns the URL only - persisting it onto the request is a separate
    // PATCH (SUBMIT_OD_PROOF), same contract every other upload route has and
    // what DocumentUploadField expects.
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`;
    return NextResponse.json({ url }, { status: 200 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[upload/leave-proof POST]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
