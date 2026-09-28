export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";
import type { StudentDocument, StudentRecord } from "@/types";

const GUARD_ROLES = ["COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"];

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember(...GUARD_ROLES);
    const { id } = await params;
    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("studentDocuments")
      .where("studentId", "==", id)
      .orderBy("createdAt", "desc")
      .get();
    return NextResponse.json({ documents: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StudentDocument) });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/[id]/documents GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Creates the Firestore doc AFTER the client already uploaded the file via
// /api/upload/student-document and has the resulting fileUrl - same two-step
// upload-then-create pattern circulars use.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember(...GUARD_ROLES);
    const { id } = await params;
    const body = (await request.json()) as Partial<StudentDocument>;

    const title = body.title?.trim();
    const fileUrl = body.fileUrl?.trim();
    const fileName = body.fileName?.trim();
    if (!title || !fileUrl || !fileName) {
      return NextResponse.json({ error: "title, fileUrl and fileName are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const studentSnap = await collegeRef.collection("students").doc(id).get();
    if (!studentSnap.exists) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }
    const student = studentSnap.data() as StudentRecord;

    const uploaderSnap = await collegeRef.collection("users").doc(session.uid).get();
    const uploaderName = (uploaderSnap.data() as { name?: string } | undefined)?.name ?? session.email;

    const now = new Date();
    const ref = collegeRef.collection("studentDocuments").doc();
    await ref.set({
      collegeId: session.collegeId,
      studentId: id,
      studentUid: student.uid ?? "",
      title,
      description: body.description?.trim() || undefined,
      fileName,
      fileUrl,
      fileType: body.fileType || undefined,
      fileSize: body.fileSize || undefined,
      uploadedByUid: session.uid,
      uploadedByName: uploaderName,
      createdAt: now,
    });

    if (student.uid) {
      await notify(db, session.collegeId, student.uid, "DOCUMENT_UPLOADED", "New Document Uploaded", `"${title}" has been added to your documents.`, "/student/documents");
    }

    return NextResponse.json({ ok: true, id: ref.id });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/[id]/documents POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
