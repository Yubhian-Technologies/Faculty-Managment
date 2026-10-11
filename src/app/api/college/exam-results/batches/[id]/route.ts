export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { actorName, batchesCol, loadResultRules, recordsCol } from "@/lib/examResults/store";
import { studentStanding, type StudentStanding } from "@/lib/examResults/gpa";
import type { ExamResultBatch, ExamResultRecord } from "@/types/examResults";

// One results sheet: GET (with every student's record and their SGPA / CGPA
// as of this semester - from their PUBLISHED results of every semester up to
// it plus this sheet itself, under the college's Result Rules), PATCH { action:
// "publish" } and DELETE (drafts only). A published sheet is locked - later
// corrections (revaluation) get their own audited edit, not a re-import.

type Params = { params: Promise<{ id: string }> };

function guardError(err: unknown, tag: string) {
  const badBody = badBodyResponse(err);
  if (badBody) return badBody;
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.error(tag, err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const { id } = await params;
    const db = getAdminDb();
    const [snap, records] = await Promise.all([
      batchesCol(db, session.collegeId).doc(id).get(),
      recordsCol(db, session.collegeId).where("batchId", "==", id).get(),
    ]);
    if (!snap.exists) return NextResponse.json({ error: "Results sheet not found" }, { status: 404 });
    const batch = snap.data() as ExamResultBatch;
    const list = records.docs
      .map((d) => ({ ...(d.data() as ExamResultRecord), id: d.id }))
      .sort((a, b) => String(a.rollNumberUpper ?? "").localeCompare(String(b.rollNumberUpper ?? "")));

    // Every result these students have: this sheet's own, plus published ones.
    const studentIds = [...new Set(list.map((r) => r.studentId))];
    const parts: string[][] = [];
    for (let i = 0; i < studentIds.length; i += 30) parts.push(studentIds.slice(i, i + 30));
    const [{ rules }, ...snaps] = await Promise.all([
      loadResultRules(db, session.collegeId),
      ...parts.map((p) => recordsCol(db, session.collegeId).where("studentId", "in", p).get()),
    ]);
    const sittings = new Map<string, Parameters<typeof studentStanding>[0]>();
    for (const s of snaps) for (const d of s.docs) {
      const r = d.data() as ExamResultRecord & { createdAt?: { toMillis?: () => number } };
      if (r.batchId !== id && r.status !== "PUBLISHED") continue;
      sittings.set(r.studentId, [...(sittings.get(r.studentId) ?? []), {
        semester: r.semester, examType: r.examType, at: r.createdAt?.toMillis?.() ?? 0, subjects: r.subjects ?? [],
      }]);
    }
    const standings: Record<string, StudentStanding> = {};
    for (const r of list) standings[r.id] = studentStanding(sittings.get(r.studentId) ?? [], batch.semester, rules);

    return NextResponse.json({ batch: { ...batch, id: snap.id }, records: list, standings, rules });
  } catch (err) {
    return guardError(err, "[exam-results/batches/[id] GET]");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const { id } = await params;
    const body = (await readJsonBody(request)) as { action?: string };
    if (body.action !== "publish") return NextResponse.json({ error: "Unknown action" }, { status: 400 });

    const db = getAdminDb();
    const ref = batchesCol(db, session.collegeId).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Results sheet not found" }, { status: 404 });
    const batch = snap.data() as ExamResultBatch;
    if (batch.status !== "DRAFT") return NextResponse.json({ error: "These results are already published" }, { status: 409 });

    const records = await recordsCol(db, session.collegeId).where("batchId", "==", id).get();
    if (records.empty) return NextResponse.json({ error: "This sheet has no results to publish" }, { status: 400 });

    const now = new Date();
    const name = await actorName(db, session.collegeId, session.uid);
    const writer = new ChunkedBatch(db);
    for (const d of records.docs) writer.update(d.ref, { status: "PUBLISHED", updatedAt: now });
    // The batch is flipped last of all, in the final write, so a sheet never
    // reads as published while some of its students are still drafts.
    await writer.commit();
    await ref.update({ status: "PUBLISHED", publishedBy: session.uid, publishedByName: name, publishedAt: now, updatedAt: now });

    await writeAuditLogSafe(db, session.collegeId, {
      action: "SEMESTER_RESULTS_PUBLISHED",
      performedBy: session.uid,
      performedByName: name,
      targetId: id,
      details: { title: batch.title, students: records.size },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return guardError(err, "[exam-results/batches/[id] PATCH]");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const { id } = await params;
    const db = getAdminDb();
    const ref = batchesCol(db, session.collegeId).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Results sheet not found" }, { status: 404 });
    const batch = snap.data() as ExamResultBatch;
    if (batch.status !== "DRAFT") return NextResponse.json({ error: "Published results cannot be deleted" }, { status: 409 });

    const records = await recordsCol(db, session.collegeId).where("batchId", "==", id).get();
    const writer = new ChunkedBatch(db);
    for (const d of records.docs) writer.delete(d.ref);
    await writer.commit();
    await ref.delete();

    await writeAuditLogSafe(db, session.collegeId, {
      action: "SEMESTER_RESULTS_DRAFT_DELETED",
      performedBy: session.uid,
      performedByName: await actorName(db, session.collegeId, session.uid),
      targetId: id,
      details: { title: batch.title, students: records.size },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return guardError(err, "[exam-results/batches/[id] DELETE]");
  }
}
