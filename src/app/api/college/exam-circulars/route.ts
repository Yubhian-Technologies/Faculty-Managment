export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminStorage } from "@/lib/firebase/admin";
import type { ExamCircularFileType } from "@/types/examCirculars";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

const MIME_TO_TYPE: Record<string, ExamCircularFileType> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

// Same broad read set as exam-configurations/exam-guidelines.
const READ_ROLES = ["EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"];

// Defense in depth for the client's own `min` date-picker constraint. Uses
// the server's UTC calendar date as the floor, which is always same-or-behind
// an IST caller's local date (IST is UTC+5:30, never negative) - so this can
// only ever be more lenient than the client check, never reject a date the
// client itself considered valid "today".
function isPastDate(dateStr: string): boolean {
  return dateStr < new Date().toISOString().slice(0, 10);
}

export async function GET() {
  try {
    const session = await requireCollegeMember(...READ_ROLES);
    const db = getAdminDb();
    const snap = await db
      .collection("colleges").doc(session.collegeId).collection("examCirculars")
      .orderBy("createdAt", "desc")
      .get();
    const circulars = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ circulars });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-circulars GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Two creation paths sharing one collection - dispatched on content-type
// rather than a body field, since the file path is multipart/form-data and
// can't carry a JSON "kind" alongside the file cleanly.
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.includes("application/json") ? postNotice(request) : postFile(request);
}

// A short structured announcement typed directly in - no file. `title` is
// kept equal to `subject` so the list can render one heading field
// regardless of kind (see ExamCircular.title's doc comment).
async function postNotice(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      courseId?: string; courseName?: string; semester?: number; totalSemesters?: number;
      noticeDate?: string; subject?: string; body?: string;
    };
    const { courseId, courseName, semester, totalSemesters, noticeDate, subject } = body;
    const noticeBody = body.body;

    if (!courseName) return NextResponse.json({ error: "Course is required" }, { status: 400 });
    if (!semester || !totalSemesters) return NextResponse.json({ error: "Semester is required" }, { status: 400 });
    if (!noticeDate) return NextResponse.json({ error: "Date is required" }, { status: 400 });
    if (isPastDate(noticeDate)) return NextResponse.json({ error: "Date cannot be in the past" }, { status: 400 });
    if (!subject?.trim()) return NextResponse.json({ error: "Subject is required" }, { status: 400 });
    if (!noticeBody?.trim()) return NextResponse.json({ error: "Body is required" }, { status: 400 });

    const db = getAdminDb();
    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Exam Cell";

    const now = new Date();
    const data = {
      collegeId: session.collegeId,
      kind: "NOTICE" as const,
      title: subject.trim(),
      ...(courseId ? { courseId } : {}),
      courseName,
      semester,
      totalSemesters,
      noticeDate,
      subject: subject.trim(),
      body: noticeBody.trim(),
      createdBy: session.uid,
      createdByName: actorName,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await db.collection("colleges").doc(session.collegeId).collection("examCirculars").add(data);
    return NextResponse.json({ circular: { id: ref.id, ...data } }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-circulars POST notice]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Upload only - no text extraction (unlike exam-guidelines). A circular is
// shown exactly as uploaded, so this just stores the file and its metadata.
async function postFile(request: Request) {
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

    const originalName = (file as File).name || `circular.${fileType}`;
    const title = (typeof titleField === "string" && titleField.trim()) || originalName.replace(/\.[^.]+$/, "");

    const downloadToken = randomUUID();
    const path = `colleges/${session.collegeId}/examCirculars/${randomUUID()}.${fileType}`;
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
      kind: "FILE" as const,
      title,
      fileUrl,
      fileName: originalName,
      fileType,
      createdBy: session.uid,
      createdByName: actorName,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await db.collection("colleges").doc(session.collegeId).collection("examCirculars").add(data);

    return NextResponse.json({ circular: { id: ref.id, ...data } }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-circulars POST file]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
