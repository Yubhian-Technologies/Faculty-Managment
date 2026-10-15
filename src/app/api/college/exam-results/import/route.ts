export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { gradeTableFor } from "@/lib/examResults/rules";
import { batchTitle, completeFromTarget, examHeldLabel, normalizeBatchMeta, type ResultBatchMeta, type TargetExam } from "@/lib/examResults/sheet";
import { applyPriorResults, applyRevaluationTargets, rollKey, validateResultRows, type FailedResultRow, type PriorResult, type RawResultRow } from "@/lib/examResults/importRows";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import { actorName, batchesCol, examMonthContext, loadResultRules, loadStudentsByRoll, loadSubjectsByCode, recordId, recordsCol } from "@/lib/examResults/store";
import type { ExamResultBatch } from "@/types/examResults";

// Semester results import (Exam Cell). One call takes up to MAX_ROWS rows of a
// sheet - the page sends a big sheet in parts, never splitting one student's
// rows across two parts.
//
//  { dryRun: true, meta, rows }       checks every row, saves nothing (the preview)
//  { meta, rows }                     creates a DRAFT batch from the first part
//  { batchId, rows }                  adds the next part to that DRAFT batch
//
// Every row is checked before anything is written; a refused row is reported
// with its sheet row number and the rest of the part is still saved.

const MAX_ROWS = 3000;

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const body = (await readJsonBody(request)) as { dryRun?: boolean; batchId?: string; meta?: unknown; rows?: RawResultRow[] };
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: "No rows to import" }, { status: 400 });
    if (rows.length > MAX_ROWS) return NextResponse.json({ error: `At most ${MAX_ROWS} rows per request` }, { status: 400 });
    const dryRun = body.dryRun === true;

    const db = getAdminDb();
    const collegeId = session.collegeId;

    // Which exam this is: the existing draft's own details, or the ones picked on the page.
    let meta: ResultBatchMeta;
    const batchId = typeof body.batchId === "string" && body.batchId.trim() ? body.batchId.trim() : null;
    if (batchId) {
      const snap = await batchesCol(db, collegeId).doc(batchId).get();
      if (!snap.exists) return NextResponse.json({ error: "Results sheet not found" }, { status: 404 });
      const b = snap.data() as ExamResultBatch;
      if (b.status !== "DRAFT") return NextResponse.json({ error: "These results are published and can no longer be added to" }, { status: 409 });
      meta = {
        courseKey: b.courseKey, courseName: b.courseName, courseIds: b.courseIds,
        department: b.department ?? "", departmentId: b.departmentId ?? "", regulation: b.regulation,
        ...(b.subDepartmentId ? { subDepartment: b.subDepartment ?? "", subDepartmentId: b.subDepartmentId } : {}),
        batch: b.batch ?? "", examHeld: b.examHeld ?? "",
        academicYear: b.academicYear, year: b.year, semester: b.semester, examType: b.examType,
        ...(b.targetBatchId ? { targetBatchId: b.targetBatchId } : {}),
        ...(b.revaluationOf ? { revaluationOf: b.revaluationOf } : {}),
      };
    } else {
      const cleaned = normalizeBatchMeta(body.meta, await examMonthContext(db, collegeId));
      if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
      meta = cleaned.meta;
      // A Supplementary / Revaluation: the exam it is for must be published and of this class.
      if (meta.targetBatchId) {
        const t = await batchesCol(db, collegeId).doc(meta.targetBatchId).get();
        const done = completeFromTarget(meta, t.exists ? (t.data() as TargetExam) : null);
        if ("error" in done) return NextResponse.json({ error: done.error }, { status: 400 });
        meta = done.meta;
      }
    }

    // The branch's sub-departments: their students belong to the branch's sheet,
    // and a picked sub-department must be one of them.
    const children = (await db.collection("colleges").doc(collegeId).collection("departments")
      .where("parentDepartmentId", "==", meta.departmentId).get()).docs.map((d) => ({ id: d.id, name: String(d.get("name") ?? "") }));
    if (meta.subDepartmentId && !children.some((c) => c.id === meta.subDepartmentId)) {
      return NextResponse.json({ error: `That sub-department is not part of ${meta.department}` }, { status: 400 });
    }
    const allowedDepartments = meta.subDepartmentId
      ? [meta.subDepartment ?? ""]
      : [meta.department, ...children.map((c) => c.name)];

    const [{ rules }, students, subjects, priorSnap] = await Promise.all([
      loadResultRules(db, collegeId),
      loadStudentsByRoll(db, collegeId, rows.map((r) => String(r.rollNumber ?? ""))),
      loadSubjectsByCode(db, collegeId, rows.map((r) => String(r.subjectCode ?? ""))),
      recordsCol(db, collegeId).where("courseKey", "==", meta.courseKey).where("semester", "==", meta.semester).get(),
    ]);
    const gradeTable = gradeTableFor(rules, meta.regulation);
    if (gradeTable.length === 0) return NextResponse.json({ error: "Set up the grade table under Result Rules first" }, { status: 400 });

    // Students with results already filed under this batch (a detained student now in a later batch).
    const batchHistory = new Set(priorSnap.docs.filter((d) => d.get("batch") === meta.batch).map((d) => String(d.get("studentId"))));
    const checked = validateResultRows(rows, {
      students, subjects, gradeTable,
      courseIds: meta.courseIds, courseName: meta.courseName, department: meta.department, allowedDepartments, regulation: meta.regulation, academicYear: meta.academicYear,
      batch: meta.batch, batchHistory,
      // For a student with no batch stored: their year of study gives it.
      currentStartYear: Number((await resolveCollegeAcademicYear(db, collegeId)).slice(0, 4)),
    });

    // A student already in THIS draft (an earlier part, or an earlier upload to it).
    const inThisBatch = new Set<string>();
    const prior: PriorResult[] = [];
    for (const d of priorSnap.docs) {
      const r = d.data() as {
        batchId: string; studentId: string; examType: PriorResult["examType"]; revaluesBatchId?: string; academicYear?: string; batch?: string;
        status?: "DRAFT" | "PUBLISHED"; subjects?: { subjectCode: string; isPass: boolean }[]; createdAt?: { toMillis?: () => number };
      };
      if (batchId && r.batchId === batchId) inThisBatch.add(r.studentId);
      else prior.push({
        studentId: r.studentId, batchId: r.batchId, examType: r.examType, academicYear: r.academicYear ?? "", status: r.status ?? "DRAFT",
        subjects: r.subjects ?? [], at: r.createdAt?.toMillis?.() ?? 0, ...(r.revaluesBatchId ? { revaluesBatchId: r.revaluesBatchId } : {}),
        ...(r.batch ? { batch: r.batch } : {}),
      });
    }
    const failed: FailedResultRow[] = [...checked.failed];
    const fresh = checked.accepted.filter((a) => {
      if (!inThisBatch.has(a.student.id)) return true;
      a.subjects.forEach((s, i) => failed.push({ row: a.rows[i], rollNumber: a.student.rollNumber, subjectCode: s.subjectCode, error: `${a.student.rollNumber} is already in this results sheet` }));
      return false;
    });
    // A revaluation re-grades one published sitting; Regular / Supplementary follow the sitting rules.
    const examLabel = `${meta.revaluationOf === "SUPPLEMENTARY" ? "Supplementary" : "Regular"} ${examHeldLabel(meta.examHeld)}`;
    const history = meta.examType === "REVALUATION"
      ? applyRevaluationTargets(fresh, prior, meta.targetBatchId ?? "", examLabel)
      : applyPriorResults(fresh, prior, meta.examType, meta.semester, meta.academicYear, { batch: meta.batch, targetBatchId: meta.targetBatchId });
    failed.push(...history.failed);
    // A student is never half-imported: if any of their rows is refused, none
    // of their rows are saved, so the corrected rows can be added later in one go.
    const refusedRolls = new Set(failed.map((f) => rollKey(f.rollNumber)));
    const accepted = history.accepted.filter((a) => {
      if (!refusedRolls.has(rollKey(a.student.rollNumber))) return true;
      a.subjects.forEach((s, i) => failed.push({
        row: a.rows[i], rollNumber: a.student.rollNumber, subjectCode: s.subjectCode,
        error: "Not saved: another row of this student was refused",
      }));
      return false;
    });
    failed.sort((a, b) => a.row - b.row);
    const subjectRows = accepted.reduce((n, a) => n + a.subjects.length, 0);
    // Subjects with no credits: allowed (a mandatory / audit course), but worth a look.
    const zeroCreditCodes = [...new Set(accepted.flatMap((a) => a.subjects.filter((s) => s.credits <= 0).map((s) => s.subjectCode)))];

    if (dryRun || accepted.length === 0) {
      return NextResponse.json({ dryRun, batchId, students: accepted.length, subjectRows, failed, zeroCreditCodes });
    }

    const now = new Date();
    const name = await actorName(db, collegeId, session.uid);
    const batchRef = batchId ? batchesCol(db, collegeId).doc(batchId) : batchesCol(db, collegeId).doc();
    const writer = new ChunkedBatch(db);
    if (batchId) {
      writer.update(batchRef, {
        studentCount: FieldValue.increment(accepted.length),
        subjectRowCount: FieldValue.increment(subjectRows),
        updatedAt: now,
      });
    } else {
      writer.set(batchRef, {
        collegeId, title: batchTitle(meta), ...meta, status: "DRAFT",
        studentCount: accepted.length, subjectRowCount: subjectRows,
        createdBy: session.uid, createdByName: name, createdAt: now, updatedAt: now,
      });
    }
    for (const a of accepted) {
      writer.set(recordsCol(db, collegeId).doc(recordId(batchRef.id, a.student.id)), {
        collegeId, batchId: batchRef.id, courseKey: meta.courseKey,
        studentId: a.student.id, rollNumber: a.student.rollNumber, rollNumberUpper: a.student.rollNumber.toUpperCase(),
        name: a.student.name, department: a.student.department,
        ...(a.student.courseId ? { courseId: a.student.courseId } : {}),
        regulation: meta.regulation, academicYear: meta.academicYear, year: meta.year, semester: meta.semester,
        batch: meta.batch, examHeld: meta.examHeld,
        ...(a.universitySgpa !== undefined ? { universitySgpa: a.universitySgpa } : {}),
        examType: meta.examType,
        ...(meta.examType === "REVALUATION" ? { revaluationOf: meta.revaluationOf, revaluesBatchId: a.revaluesBatchId } : {}),
        status: "DRAFT", subjects: a.subjects, createdAt: now, updatedAt: now,
      });
    }
    await writer.commit();

    await writeAuditLogSafe(db, collegeId, {
      action: "SEMESTER_RESULTS_IMPORTED",
      performedBy: session.uid,
      performedByName: name,
      targetId: batchRef.id,
      details: { title: batchTitle(meta), students: accepted.length, subjectRows, refusedRows: failed.length },
    });
    return NextResponse.json({ dryRun: false, batchId: batchRef.id, students: accepted.length, subjectRows, failed, zeroCreditCodes }, { status: 201 });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[exam-results/import POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
