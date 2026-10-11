export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { passwordChangeRequired, passwordChangeRequiredResponse } from "@/lib/students/passwordGate";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { StudentRecord } from "@/types";

// A student removes a document THEY uploaded. Anything the College Office put on file (no `selfUploaded` flag) and
// any other student's document is refused - those stay with the Office.
export async function DELETE(_request: Request, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const session = await requireCollegeMember("STUDENT");
    const { docId } = await params;
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const studentSnap = await collegeRef.collection("students").where("uid", "==", session.uid).limit(1).get();
    if (studentSnap.empty) return NextResponse.json({ error: "Student record not found" }, { status: 404 });
    if (passwordChangeRequired(studentSnap.docs[0].data() as Pick<StudentRecord, "mustChangePassword">)) return passwordChangeRequiredResponse();
    const studentId = studentSnap.docs[0].id;

    const ref = collegeRef.collection("studentDocuments").doc(docId);
    const snap = await ref.get();
    const data = snap.data() as { studentId?: string; selfUploaded?: boolean } | undefined;
    if (!snap.exists || data?.studentId !== studentId) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (data?.selfUploaded !== true) {
      return NextResponse.json({ error: "Only documents you uploaded yourself can be removed - contact the College Office for the others" }, { status: 403 });
    }
    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student/me/documents/[docId] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
