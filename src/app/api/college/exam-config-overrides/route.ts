export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { guardError, actorName } from "@/lib/midBank/server";
import { checkMarksBreakdown } from "@/lib/exams/marksBreakdown";
import { subjectOverrideId, subjectTypeToExamType } from "@/lib/exams/internalExamMarks";
import type { InternalExamMarksBatch, Subject, TeachingAssignment } from "@/types";

// Exam Cell > Mid Configuration > Marks: subject exceptions - one subject's own
// internal marks breakdown (its own components), used in every branch that
// takes it instead of the branch + year configuration (`loadExamConfig`).
// Refused once marks have been entered for the subject in a current teaching
// assignment, so entered marks are never read against a different breakdown.

const ROLES = ["EXAM_CELL", "SUPER_ADMIN"];

/** Names of the faculty with marks already entered for the subject this cycle (empty = free to change). */
async function marksEnteredBy(db: FirebaseFirestore.Firestore, collegeId: string, subjectId: string): Promise<string[]> {
  const college = db.collection("colleges").doc(collegeId);
  const batches = (await college.collection("internalExamMarks").where("subjectId", "==", subjectId).get()).docs
    .map((d) => d.data() as InternalExamMarksBatch).filter((b) => (b.enteredCount ?? 0) > 0);
  if (batches.length === 0) return [];
  const tas = await db.getAll(...batches.map((b) => college.collection("teachingAssignments").doc(b.assignmentId)));
  const current = batches.filter((_, i) => tas[i].exists && !(tas[i].data() as TeachingAssignment).isPast);
  return [...new Set(current.map((b) => `${b.facultyName} (${b.sectionName})`))];
}

export async function GET() {
  try {
    const session = await requireCollegeMember(...ROLES);
    const snap = await getAdminDb().collection("colleges").doc(session.collegeId).collection("examConfigSubjectOverrides").get();
    const overrides = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String((a as { subjectCode?: string }).subjectCode).localeCompare(String((b as { subjectCode?: string }).subjectCode)));
    return NextResponse.json({ overrides });
  } catch (err) {
    return guardError(err, "[college/exam-config-overrides GET]");
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const body = (await readJsonBody(request)) as { subjectId?: string; internalMaxMarks?: unknown; externalMaxMarks?: unknown; components?: unknown };
    const subjectId = String(body.subjectId ?? "");
    const db = getAdminDb();
    const college = db.collection("colleges").doc(session.collegeId);
    const subjectSnap = subjectId ? await college.collection("subjects").doc(subjectId).get() : null;
    if (!subjectSnap?.exists) return NextResponse.json({ error: "Pick a subject" }, { status: 400 });
    const subject = subjectSnap.data() as Subject;
    const checked = checkMarksBreakdown(body);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    const locked = await marksEnteredBy(db, session.collegeId, subjectId);
    if (locked.length) return NextResponse.json({ error: `Marks are already entered for ${subject.name} (${locked.slice(0, 3).join(", ")}${locked.length > 3 ? " ..." : ""}) - its breakdown can't change now` }, { status: 409 });
    const examType = subjectTypeToExamType(subject.type);
    const now = new Date();
    const data = {
      subjectId, subjectCode: subject.code, subjectName: subject.name, regulation: subject.regulation ?? "", examType,
      internalMaxMarks: checked.internalMaxMarks, externalMaxMarks: checked.externalMaxMarks, components: checked.components, status: "ACTIVE",
      updatedBy: session.uid, updatedByName: await actorName(db, session.collegeId, session.uid), updatedAt: now,
    };
    await college.collection("examConfigSubjectOverrides").doc(subjectOverrideId(subjectId, examType)).set(data);
    return NextResponse.json({ override: { id: subjectOverrideId(subjectId, examType), ...data } });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/exam-config-overrides PUT]");
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("examConfigSubjectOverrides").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ ok: true });
    const locked = await marksEnteredBy(db, session.collegeId, String(snap.get("subjectId")));
    if (locked.length) return NextResponse.json({ error: "Marks are already entered under this breakdown - it can't be removed now" }, { status: 409 });
    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return guardError(err, "[college/exam-config-overrides DELETE]");
  }
}
