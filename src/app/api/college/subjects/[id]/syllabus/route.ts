export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminStorage } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { reviewingDepartment } from "@/lib/midBank/reviewer";
import { actorName } from "@/lib/midBank/server";
import { ownerDepartmentNamesLive } from "@/lib/subjects/ownerDepartment";
import { CURRICULUM_ROLES, subjectErrorResponse } from "@/lib/subjects/http";
import { SubjectMasterService } from "@/lib/subjects/services/SubjectMasterService";
import type { Subject, SubjectSyllabus, SyllabusHistoryEntry } from "@/types";
import { HISTORY_MAX } from "@/lib/subjects/syllabus";
import { ACADEMICS_ROLES, loadSyllabus, syllabusCol } from "@/lib/subjects/syllabusServer";

// A subject's syllabus document: uploaded (POST multipart `file`) or removed (DELETE) by
// Academics / Principal / VP, or by the HOD of a Subject Department of the subject (one shared file). Faculty preparing
// its question banks / papers see it. PDF only, up to 10 MB.

type Params = { params: Promise<{ id: string }> };
const MAX_SIZE = 10 * 1024 * 1024;

async function authorize(id: string) {
  const session = await requireCollegeMember(...CURRICULUM_ROLES, "HOD");
  const db = getAdminDb();
  const snap = await db.collection("colleges").doc(session.collegeId).collection("subjects").doc(id).get();
  if (!snap.exists) return { error: NextResponse.json({ error: "Subject not found. It may have been deleted." }, { status: 404 }) };
  const subject = snap.data() as Subject;
  if (!subject.courseId) return { error: NextResponse.json({ error: "Only Curriculum subjects have a syllabus here" }, { status: 400 }) };
  if (session.role === "HOD") {
    const owners = await ownerDepartmentNamesLive(db, session.collegeId, subject);
    const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
    if (!reviewingDepartment(scope, owners, true)) {
      return { error: NextResponse.json({ error: "Only the HOD of this subject's department can change its syllabus" }, { status: 403 }) };
    }
  }
  // Submitted / frozen syllabus: only Academics changes the PDF now (recorded in the syllabus history once frozen).
  const syllabus = await loadSyllabus(db, session.collegeId, id);
  if ((syllabus?.status === "SUBMITTED" || syllabus?.status === "FROZEN") && !ACADEMICS_ROLES.includes(session.role)) {
    return { error: NextResponse.json({ error: syllabus.status === "FROZEN" ? "The syllabus is frozen - only Academics can change it" : "The syllabus is with Academics for freezing - it can't be changed meanwhile" }, { status: 409 }) };
  }
  const name = (await actorName(db, session.collegeId, session.uid)) || session.email;
  return { session, name, db, frozen: syllabus?.status === "FROZEN", before: subject.syllabusFileName ?? "" };
}

/** A frozen syllabus keeps every change: the PDF replaced / removed by Academics, when and by whom. */
async function recordPdfChange(a: { session: { uid: string; collegeId: string }; name: string; db: FirebaseFirestore.Firestore; before: string }, id: string, after: string) {
  const ref = syllabusCol(a.db, a.session.collegeId).doc(id);
  await a.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const cur = snap.data() as SubjectSyllabus;
    const entry: SyllabusHistoryEntry = { at: new Date().toISOString(), byUid: a.session.uid, byName: a.name, role: "ACADEMICS", action: "PDF_CHANGED", changes: [{ field: "Syllabus PDF", before: a.before || "-", after }] };
    tx.update(ref, { history: [...(cur.history ?? []), entry].slice(-HISTORY_MAX) });
  });
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const a = await authorize(id);
    if ("error" in a) return a.error;
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "Select a file to upload." }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_SIZE) return NextResponse.json({ error: "The file is larger than 10 MB. Upload a smaller file." }, { status: 400 });
    // A real PDF: starts with "%PDF-".
    if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 400 });

    const token = randomUUID();
    const path = `subject-syllabi/${a.session.collegeId}/${id}/${randomUUID()}.pdf`;
    const bucket = getAdminStorage().bucket();
    await bucket.file(path).save(buffer, {
      metadata: { cacheControl: "public, max-age=604800", contentType: "application/pdf", metadata: { firebaseStorageDownloadTokens: token } },
      resumable: false,
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    const fileName = ((file as File).name || "syllabus.pdf").slice(0, 200);
    await new SubjectMasterService().setSyllabus({ collegeId: a.session.collegeId, id, file: { url, fileName }, actor: { uid: a.session.uid, name: a.name } });
    if (a.frozen) await recordPdfChange(a, id, fileName);
    return NextResponse.json({ syllabusUrl: url, syllabusFileName: fileName });
  } catch (err) {
    return subjectErrorResponse(err, "[subjects/[id]/syllabus POST]");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const a = await authorize(id);
    if ("error" in a) return a.error;
    await new SubjectMasterService().setSyllabus({ collegeId: a.session.collegeId, id, file: null, actor: { uid: a.session.uid, name: a.name } });
    if (a.frozen) await recordPdfChange(a, id, "(removed)");
    return NextResponse.json({ success: true });
  } catch (err) {
    return subjectErrorResponse(err, "[subjects/[id]/syllabus DELETE]");
  }
}
