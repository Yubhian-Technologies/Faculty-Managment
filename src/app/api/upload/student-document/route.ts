export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminStorage } from "@/lib/firebase/admin";
import { passwordChangeRequired, passwordChangeRequiredResponse } from "@/lib/students/passwordGate";
import type { StudentRecord } from "@/types";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
};
const EXT_TO_EXT: Record<string, string> = { pdf: "pdf", png: "png", jpg: "jpg", jpeg: "jpg" };

// Mirrors upload/faculty-document/route.ts exactly - same guard/size/mime
// pattern, storage path scoped per-student instead of per-faculty. A STUDENT may
// also upload (My Profile > Additional Information), but only into their OWN
// folder: the studentId is resolved from their session, never read from the form.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "STUDENT");

    const formData = await request.formData();
    const file = formData.get("file");
    let studentId = formData.get("studentId");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (session.role === "STUDENT") {
      const snap = await getAdminDb().collection("colleges").doc(session.collegeId).collection("students").where("uid", "==", session.uid).limit(1).get();
      if (snap.empty) return NextResponse.json({ error: "Student record not found" }, { status: 404 });
      if (passwordChangeRequired(snap.docs[0].data() as Pick<StudentRecord, "mustChangePassword">)) return passwordChangeRequiredResponse();
      studentId = snap.docs[0].id;
    }
    if (!studentId || typeof studentId !== "string") {
      return NextResponse.json({ error: "studentId is required" }, { status: 400 });
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
    const path = `student-documents/${studentId}/${randomUUID()}.${ext}`;
    const contentType = file.type || (ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg");

    const bucket = getAdminStorage().bucket();
    const fileRef = bucket.file(path);
    await fileRef.save(buffer, {
      metadata: { cacheControl: "public, max-age=604800", contentType, metadata: { firebaseStorageDownloadTokens: downloadToken } },
      resumable: false,
    });

    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`;
    return NextResponse.json({ url, fileName: (file as File).name, fileType: file.type, fileSize: buffer.byteLength }, { status: 200 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[upload/student-document POST]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
