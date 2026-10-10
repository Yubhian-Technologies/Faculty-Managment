export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { passwordChangeRequired, passwordChangeRequiredResponse } from "@/lib/students/passwordGate";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminStorage } from "@/lib/firebase/admin";
import { MAX_SELF_DOCUMENTS_PER_KIND, SELF_DOCUMENT_KIND_BY_KEY, isOwnDocumentUrl, validateOwnDocumentBody } from "@/lib/students/ownDocuments";
import type { StudentDocument, StudentRecord } from "@/types";

// Student's own documents - resolved from session.uid only, same pattern as
// every other student/me/* route.
export async function GET() {
  try {
    const session = await requireCollegeMember("STUDENT");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const studentSnap = await collegeRef.collection("students").where("uid", "==", session.uid).limit(1).get();
    if (studentSnap.empty) {
      return NextResponse.json({ documents: [] });
    }
    if (passwordChangeRequired(studentSnap.docs[0].data() as { mustChangePassword?: boolean })) return passwordChangeRequiredResponse();
    const studentId = studentSnap.docs[0].id;

    const snap = await collegeRef
      .collection("studentDocuments")
      .where("studentId", "==", studentId)
      .orderBy("createdAt", "desc")
      .get();
    return NextResponse.json({ documents: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StudentDocument) });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student/me/documents GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// The student adds the supporting document for one of their two Additional Information answers (Studied Outside AP /
// Family ID Linked to Another State). The file was already uploaded via /api/upload/student-document (which put it in
// THEIR folder); this records it. Always stored as documentType "OTHER" named after the answer, flagged `selfUploaded`
// + `selfUploadKind`, so it can never pass for an Office-issued certificate.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("STUDENT");
    const parsed = validateOwnDocumentBody(await readJsonBody(request));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.value;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const studentSnap = await collegeRef.collection("students").where("uid", "==", session.uid).limit(1).get();
    if (studentSnap.empty) return NextResponse.json({ error: "Student record not found" }, { status: 404 });
    const student = studentSnap.docs[0].data() as StudentRecord;
    if (passwordChangeRequired(student)) return passwordChangeRequiredResponse();
    const studentId = studentSnap.docs[0].id;

    if (!isOwnDocumentUrl(input.fileUrl, getAdminStorage().bucket().name, studentId)) {
      return NextResponse.json({ error: "Upload the file again - it was not stored with your documents" }, { status: 400 });
    }

    const existing = await collegeRef.collection("studentDocuments")
      .where("studentId", "==", studentId).where("selfUploadKind", "==", input.kind).count().get();
    if (existing.data().count >= MAX_SELF_DOCUMENTS_PER_KIND) {
      return NextResponse.json({ error: `You can keep up to ${MAX_SELF_DOCUMENTS_PER_KIND} documents here - remove one first` }, { status: 400 });
    }

    const ref = collegeRef.collection("studentDocuments").doc();
    await ref.set({
      collegeId: session.collegeId,
      studentId,
      studentUid: session.uid,
      documentType: "OTHER",
      customTypeLabel: SELF_DOCUMENT_KIND_BY_KEY.get(input.kind)!.label,
      ...(input.description ? { description: input.description } : {}),
      fileName: input.fileName,
      fileUrl: input.fileUrl,
      ...(input.fileType ? { fileType: input.fileType } : {}),
      ...(input.fileSize !== undefined ? { fileSize: input.fileSize } : {}),
      uploadedByUid: session.uid,
      uploadedByName: student.name || session.email,
      selfUploaded: true,
      selfUploadKind: input.kind,
      createdAt: new Date(),
    });
    return NextResponse.json({ ok: true, id: ref.id });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student/me/documents POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
