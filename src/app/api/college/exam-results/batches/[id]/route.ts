export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { actorName, batchesCol, loadResultRules, recordsCol } from "@/lib/examResults/store";
import { studentStanding, type StudentStanding } from "@/lib/examResults/gpa";
import { batchMatches, effectiveBatch } from "@/lib/examResults/importRows";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
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
        semester: r.semester, academicYear: r.academicYear, examHeld: r.examHeld, examType: r.examType, batchId: r.batchId,
        ...(r.revaluesBatchId ? { revaluesBatchId: r.revaluesBatchId } : {}),
        at: r.createdAt?.toMillis?.() ?? 0, subjects: r.subjects ?? [],
      }]);
    }
    const standings: Record<string, StudentStanding> = {};
    for (const r of list) standings[r.id] = studentStanding(sittings.get(r.studentId) ?? [], batch.semester, rules);

    // Regular sheets: students of this batch + branch with no result in it (absent
    // from the file, or a row refused) - a warning before Publish, never a block.
    let missing: { rollNumber: string; name: string }[] = [];
    if (batch.examType === "REGULAR" && batch.batch && batch.department) {
      const inSheet = new Set(list.map((r) => r.studentId));
      const currentStartYear = Number((await resolveCollegeAcademicYear(db, session.collegeId)).slice(0, 4));
      const studentsCol = db.collection("colleges").doc(session.collegeId).collection("students");
      // A sub-department sheet: its own students. A branch sheet: the branch's and its sub-departments'.
      const names = batch.subDepartment
        ? [batch.subDepartment]
        : [batch.department, ...(await db.collection("colleges").doc(session.collegeId).collection("departments")
            .where("parentDepartmentId", "==", batch.departmentId).get()).docs.map((d) => String(d.get("name") ?? "")).filter(Boolean)];
      const [own, core] = await Promise.all([
        studentsCol.where("department", "in", names.slice(0, 30)).get(),
        studentsCol.where("secondaryDepartment", "in", names.slice(0, 30)).get(),
      ]);
      const seen = new Set<string>();
      for (const d of [...own.docs, ...core.docs]) {
        if (seen.has(d.id) || inSheet.has(d.id)) continue;
        seen.add(d.id);
        const st = d.data() as { rollNumber?: string; name?: string; batch?: string; status?: string; courseId?: string; year?: number; studentType?: string };
        if (st.status === "DISCONTINUED") continue;
        if (st.courseId && !batch.courseIds.includes(st.courseId)) continue;
        // No batch stored: worked out from the year of study, as the import does.
        const eff = effectiveBatch({ batch: st.batch, year: st.year }, currentStartYear);
        if (!eff || !batchMatches(eff.batch, batch.batch)) continue;
        // A lateral entrant joins in Year 2, so a Year 1 exam is not theirs -
        // known from their type, or from a batch starting later than the
        // cohort's (2025-2028 in a 2024-2028 cohort).
        const lateral = String(st.studentType ?? "").trim().toUpperCase() === "LATERAL";
        const joinedYear = Math.max(lateral ? 2 : 1, 1 + (Number(eff.batch.slice(0, 4)) - Number(batch.batch.slice(0, 4))));
        if (Number.isFinite(joinedYear) && batch.year < joinedYear) continue;
        missing.push({ rollNumber: st.rollNumber ?? "", name: st.name ?? "" });
      }
      missing = missing.sort((a, b) => a.rollNumber.localeCompare(b.rollNumber)).slice(0, 500);
    }

    return NextResponse.json({ batch: { ...batch, id: snap.id }, records: list, standings, rules, missing });
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
