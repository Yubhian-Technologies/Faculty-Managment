export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminStorage } from "@/lib/firebase/admin";
import { extractTextFromFile, splitIntoPoints } from "@/lib/examGuidelines/extractPoints";
import type { ExamGuidelineFileType } from "@/types/examGuidelines";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

const MIME_TO_TYPE: Record<string, ExamGuidelineFileType> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

// Same broad read set as /api/college/exam-configurations - Exam Cell manages
// these, Principal/VP/Super Admin can see what's been published.
const READ_ROLES = ["EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"];

export async function GET() {
  try {
    const session = await requireCollegeMember(...READ_ROLES);
    const db = getAdminDb();
    const snap = await db
      .collection("colleges").doc(session.collegeId).collection("examGuidelines")
      .orderBy("createdAt", "desc")
      .get();
    const guidelines = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ guidelines });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-guidelines GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Upload a PDF/Word file, extract its text, and split it into a point-wise
// list right away - there is no separate "review before publishing" step
// (see the ambient note in types/examGuidelines.ts on why: no student portal
// exists yet to publish to, so this is Exam Cell's own reference list for now).
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");

    const formData = await request.formData();
    const file = formData.get("file");
    const titleField = formData.get("title");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const fileType = MIME_TO_TYPE[file.type];
    if (!fileType) {
      return NextResponse.json({ error: "Only PDF or Word (.docx) files are accepted" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_SIZE) {
      return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 400 });
    }

    let rawText: string;
    try {
      rawText = await extractTextFromFile(buffer, fileType);
    } catch (err) {
      console.error("[college/exam-guidelines POST] extraction failed", err);
      return NextResponse.json({ error: "Couldn't read this file - it may be corrupted or password-protected" }, { status: 400 });
    }

    const points = splitIntoPoints(rawText);
    if (points.length === 0) {
      return NextResponse.json(
        { error: "Couldn't find any text in this file - it may be a scanned/image-only document" },
        { status: 400 }
      );
    }

    const originalName = (file as File).name || `guidelines.${fileType}`;
    const title = (typeof titleField === "string" && titleField.trim()) || originalName.replace(/\.[^.]+$/, "");

    const downloadToken = randomUUID();
    const path = `colleges/${session.collegeId}/examGuidelines/${randomUUID()}.${fileType}`;
    const bucket = getAdminStorage().bucket();
    await bucket.file(path).save(buffer, {
      metadata: { contentType: file.type, metadata: { firebaseStorageDownloadTokens: downloadToken } },
      resumable: false,
    });
    const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`;

    const db = getAdminDb();
    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Exam Cell";

    const now = new Date();
    const data = {
      collegeId: session.collegeId,
      title,
      points,
      fileUrl,
      fileName: originalName,
      fileType,
      createdBy: session.uid,
      createdByName: actorName,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await db.collection("colleges").doc(session.collegeId).collection("examGuidelines").add(data);

    return NextResponse.json({ guideline: { id: ref.id, ...data } }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-guidelines POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
