export const dynamic = "force-dynamic";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { gradeTableFor } from "@/lib/examResults/rules";
import { batchTitle, completeFromTarget, examHeldLabel, normalizeBatchMeta, type ResultBatchMeta, type TargetExam } from "@/lib/examResults/sheet";
import {
  applyPriorResults, applyRevaluationTargets, groupByBranch, rollKey, validateResultRows, wrongBatchFile,
  type AcceptedStudentResult, type DepartmentRef, type FailedResultRow, type PriorResult, type RawResultRow,
} from "@/lib/examResults/importRows";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import { actorName, batchesCol, examMonthContext, loadResultRules, loadStudentsByRoll, loadSubjectsByCode, recordId, recordsCol } from "@/lib/examResults/store";
import type { ExamResultBatch } from "@/types/examResults";

// Semester results import (Exam Cell). One call takes up to MAX_ROWS rows of a
// sheet - the page sends a big sheet in parts, never splitting one student's
// rows across two parts.
//
//  { dryRun: true, meta, rows }            checks every row, saves nothing (the preview)
//  { meta, rows [, uploadId] }             saves as DRAFT sheet(s)
//  { batchId, rows }                       adds rows to that one DRAFT sheet ("Add rows")
//
// With no branch in `meta` the file is EVERY branch at once: each student's own
// department decides their sheet (groupByBranch - a sub-department gets its
// own, a 1st year under Basic Science goes to their core department), and one
// draft is created per branch. Those drafts share an `uploadId`, which the next
// part of the same file passes back so its students join the same sheets.
//
// The batch is a note, never a refusal: each result goes to its Roll No's student, filed under
// the exam picked, whatever batch they are in now (a detained student). They are listed back
// as `otherBatch`; only a file that is MOSTLY another batch is stopped (wrongBatchFile).
//
// Every row is checked before anything is written; a refused row is reported
// with its sheet row number and the rest of the part is still saved.

const MAX_ROWS = 3000;

type Group = { department: string; departmentId: string; subDepartment?: string; subDepartmentId?: string; students: AcceptedStudentResult[] };

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const body = (await readJsonBody(request)) as { dryRun?: boolean; batchId?: string; uploadId?: string; meta?: unknown; rows?: RawResultRow[] };
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: "No rows to import" }, { status: 400 });
    if (rows.length > MAX_ROWS) return NextResponse.json({ error: `At most ${MAX_ROWS} rows per request` }, { status: 400 });
    const dryRun = body.dryRun === true;

    const db = getAdminDb();
    const collegeId = session.collegeId;
    const deptCol = db.collection("colleges").doc(collegeId).collection("departments");

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
        ...(b.targetExam ? { targetExam: b.targetExam } : {}),
        ...(b.revaluationOf ? { revaluationOf: b.revaluationOf } : {}),
      };
    } else {
      const cleaned = normalizeBatchMeta(body.meta, await examMonthContext(db, collegeId));
      if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
      meta = cleaned.meta;
      // A Supplementary / Revaluation: the exam it is for must be published and of this class.
      let target: TargetExam | null = null;
      if (meta.targetBatchId) {
        const t = await batchesCol(db, collegeId).doc(meta.targetBatchId).get();
        target = t.exists ? (t.data() as TargetExam) : null;
      } else if (meta.targetExam) {
        // An exam across branches: any of its published branch sheets stands for it.
        const te = meta.targetExam;
        const all = await batchesCol(db, collegeId).where("courseKey", "==", meta.courseKey).where("semester", "==", meta.semester).get();
        const match = all.docs.map((d) => d.data() as ExamResultBatch).find((x) =>
          x.status === "PUBLISHED" && x.batch === meta.batch && x.year === meta.year && x.examType === te.examType && x.examHeld === te.examHeld
          && (!meta.departmentId || x.departmentId === meta.departmentId));
        target = (match as unknown as TargetExam) ?? null;
      }
      if (meta.targetBatchId || meta.targetExam) {
        const done = completeFromTarget(meta, target);
        if ("error" in done) return NextResponse.json({ error: done.error }, { status: 400 });
        meta = done.meta;
      }
    }
    const everyBranch = !meta.departmentId;

    // One branch: its sub-departments' students belong to its sheet, and a
    // picked sub-department must be one of them. Every branch: all departments,
    // to group the students.
    const departments: DepartmentRef[] = (await deptCol.get()).docs.map((d) => ({
      id: d.id, name: String(d.get("name") ?? ""), parentDepartmentId: d.get("parentDepartmentId") || undefined,
    }));
    let allowedDepartments: string[] | undefined;
    if (!everyBranch) {
      const children = departments.filter((d) => d.parentDepartmentId === meta.departmentId);
      if (meta.subDepartmentId && !children.some((c) => c.id === meta.subDepartmentId)) {
        return NextResponse.json({ error: `That sub-department is not part of ${meta.department}` }, { status: 400 });
      }
      allowedDepartments = meta.subDepartmentId ? [meta.subDepartment ?? ""] : [meta.department, ...children.map((c) => c.name)];
    }

    const [{ rules }, students, subjects, priorSnap, batchSnap] = await Promise.all([
      loadResultRules(db, collegeId),
      loadStudentsByRoll(db, collegeId, rows.map((r) => String(r.rollNumber ?? ""))),
      loadSubjectsByCode(db, collegeId, rows.map((r) => String(r.subjectCode ?? ""))),
      recordsCol(db, collegeId).where("courseKey", "==", meta.courseKey).where("semester", "==", meta.semester).get(),
      // Who has results filed under this batch in ANY semester (a detained student now in a later batch).
      meta.batch ? recordsCol(db, collegeId).where("courseKey", "==", meta.courseKey).where("batch", "==", meta.batch).select("studentId").get() : null,
    ]);
    const gradeTable = gradeTableFor(rules, meta.regulation);
    if (gradeTable.length === 0) return NextResponse.json({ error: "Set up the grade table under Result Rules first" }, { status: 400 });

    // The drafts this file is adding to: the one sheet, or every sheet of the upload so far.
    const uploadId = everyBranch && !batchId ? (typeof body.uploadId === "string" && body.uploadId.trim() ? body.uploadId.trim() : randomUUID()) : undefined;
    const uploadSheets = new Map<string, string>(); // `${departmentId}|${subDepartmentId}` -> sheet id
    if (uploadId && body.uploadId) {
      const snap = await batchesCol(db, collegeId).where("uploadId", "==", uploadId).get();
      for (const d of snap.docs) {
        const b = d.data() as ExamResultBatch;
        if (b.status !== "DRAFT") return NextResponse.json({ error: "Part of this upload is already published - start a new upload" }, { status: 409 });
        uploadSheets.set(`${b.departmentId}|${b.subDepartmentId ?? ""}`, d.id);
      }
    }
    const ownSheets = new Set<string>(batchId ? [batchId] : [...uploadSheets.values()]);

    // Students with results already filed under this batch, any semester (a detained student
    // now in a later batch, included once - later uploads of this batch accept them as they are).
    const batchHistory = new Set((batchSnap?.docs ?? []).map((d) => String(d.get("studentId"))));
    const checked = validateResultRows(rows, {
      students, subjects, gradeTable,
      courseIds: meta.courseIds, courseName: meta.courseName, department: everyBranch ? "" : meta.department, allowedDepartments,
      regulation: meta.regulation, academicYear: meta.academicYear,
      batch: meta.batch, batchHistory,
      // For a student with no batch stored: their year of study gives it.
      currentStartYear: Number((await resolveCollegeAcademicYear(db, collegeId)).slice(0, 4)),
    });
    // A file that is mostly another batch: the batch picked is probably wrong - nothing is saved.
    const wrongBatch = meta.batch ? wrongBatchFile(checked.accepted, meta.batch) : null;
    if (wrongBatch) return NextResponse.json({ error: wrongBatch }, { status: 400 });

    // A student already in THESE draft(s) (an earlier part, or an earlier upload to it).
    const alreadyIn = new Set<string>();
    const prior: PriorResult[] = [];
    for (const d of priorSnap.docs) {
      const r = d.data() as {
        batchId: string; studentId: string; examType: PriorResult["examType"]; revaluesBatchId?: string; academicYear?: string; batch?: string; examHeld?: string;
        status?: "DRAFT" | "PUBLISHED"; subjects?: { subjectCode: string; isPass: boolean }[]; createdAt?: { toMillis?: () => number };
      };
      if (ownSheets.has(r.batchId)) alreadyIn.add(r.studentId);
      else prior.push({
        studentId: r.studentId, batchId: r.batchId, examType: r.examType, academicYear: r.academicYear ?? "", status: r.status ?? "DRAFT",
        subjects: r.subjects ?? [], at: r.createdAt?.toMillis?.() ?? 0, ...(r.revaluesBatchId ? { revaluesBatchId: r.revaluesBatchId } : {}),
        ...(r.batch ? { batch: r.batch } : {}),
        ...(r.examHeld ? { examHeld: r.examHeld } : {}),
      } as PriorResult);
    }
    const failed: FailedResultRow[] = [...checked.failed];
    const fresh = checked.accepted.filter((a) => {
      if (!alreadyIn.has(a.student.id)) return true;
      a.subjects.forEach((s, i) => failed.push({ row: a.rows[i], rollNumber: a.student.rollNumber, subjectCode: s.subjectCode, error: `${a.student.rollNumber} is already in this results sheet` }));
      return false;
    });

    // The picked exam, per student: an exam across branches means each student's own branch sheet of it.
    let targetByStudent: Map<string, string> | undefined;
    if (meta.targetExam) {
      const te = meta.targetExam;
      targetByStudent = new Map();
      for (const p of prior as (PriorResult & { examHeld?: string })[]) {
        if (p.status === "PUBLISHED" && p.examType === te.examType && p.examHeld === te.examHeld) targetByStudent.set(p.studentId, p.batchId);
      }
    }
    // A revaluation re-grades one published sitting; Regular / Supplementary follow the sitting rules.
    const examLabel = `${meta.revaluationOf === "SUPPLEMENTARY" ? "Supplementary" : "Regular"} ${examHeldLabel(meta.examHeld)}`;
    const history = meta.examType === "REVALUATION"
      ? applyRevaluationTargets(fresh, prior, targetByStudent ?? meta.targetBatchId ?? "", examLabel)
      : applyPriorResults(fresh, prior, meta.examType, meta.semester, meta.academicYear, {
          batch: meta.batch, ...(targetByStudent ? { targetByStudent } : { targetBatchId: meta.targetBatchId }),
        });
    failed.push(...history.failed);

    // Every branch: which sheet each student goes to (by their own department).
    let groups: Group[];
    let candidates = history.accepted;
    if (everyBranch && !batchId) {
      const grouped = groupByBranch(candidates, departments);
      failed.push(...grouped.failed);
      groups = grouped.groups;
      candidates = groups.flatMap((g) => g.students);
    } else {
      groups = [{ department: meta.department, departmentId: meta.departmentId, ...(meta.subDepartmentId ? { subDepartment: meta.subDepartment, subDepartmentId: meta.subDepartmentId } : {}), students: candidates }];
    }

    // A student is never half-imported: if any of their rows is refused, none
    // of their rows are saved, so the corrected rows can be added later in one go.
    const refusedRolls = new Set(failed.map((f) => rollKey(f.rollNumber)));
    const keep = (a: AcceptedStudentResult) => {
      if (!refusedRolls.has(rollKey(a.student.rollNumber))) return true;
      a.subjects.forEach((s, i) => failed.push({ row: a.rows[i], rollNumber: a.student.rollNumber, subjectCode: s.subjectCode, error: "Not saved: another row of this student was refused" }));
      return false;
    };
    const keptIds = new Set(candidates.filter(keep).map((a) => a.student.id));
    groups = groups.map((g) => ({ ...g, students: g.students.filter((a) => keptIds.has(a.student.id)) })).filter((g) => g.students.length > 0);
    const accepted = groups.flatMap((g) => g.students);
    failed.sort((a, b) => a.row - b.row);
    const subjectRows = accepted.reduce((n, a) => n + a.subjects.length, 0);
    // Subjects with no credits: allowed (a mandatory / audit course), but worth a look.
    const zeroCreditCodes = [...new Set(accepted.flatMap((a) => a.subjects.filter((s) => s.credits <= 0).map((s) => s.subjectCode)))];
    const groupSummary = groups.map((g) => ({ department: g.department, subDepartment: g.subDepartment ?? "", students: g.students.length }));
    // Students included as detained (now in a later batch) - listed back so the Exam Cell sees who.
    const otherBatch = accepted.filter((a) => a.otherBatch !== undefined).map((a) => ({ rollNumber: a.student.rollNumber, batch: a.otherBatch! }));

    if (dryRun || accepted.length === 0) {
      return NextResponse.json({ dryRun, batchId, uploadId: body.uploadId ?? null, students: accepted.length, subjectRows, failed, zeroCreditCodes, groups: groupSummary, otherBatch });
    }

    const now = new Date();
    const name = await actorName(db, collegeId, session.uid);
    const writer = new ChunkedBatch(db);
    const sheetIds: string[] = [];
    for (const g of groups) {
      const groupMeta: ResultBatchMeta = {
        ...meta, department: g.department, departmentId: g.departmentId,
        ...(g.subDepartmentId ? { subDepartment: g.subDepartment, subDepartmentId: g.subDepartmentId } : { subDepartment: undefined, subDepartmentId: undefined }),
      };
      const existing = batchId ?? uploadSheets.get(`${g.departmentId}|${g.subDepartmentId ?? ""}`);
      const ref = existing ? batchesCol(db, collegeId).doc(existing) : batchesCol(db, collegeId).doc();
      const groupRows = g.students.reduce((n, a) => n + a.subjects.length, 0);
      if (existing) {
        writer.update(ref, { studentCount: FieldValue.increment(g.students.length), subjectRowCount: FieldValue.increment(groupRows), updatedAt: now });
      } else {
        const stored = Object.fromEntries(Object.entries({ ...groupMeta, ...(uploadId ? { uploadId } : {}) }).filter(([, v]) => v !== undefined));
        writer.set(ref, {
          collegeId, title: batchTitle(groupMeta), ...stored, status: "DRAFT",
          studentCount: g.students.length, subjectRowCount: groupRows,
          createdBy: session.uid, createdByName: name, createdAt: now, updatedAt: now,
        });
        if (uploadId) uploadSheets.set(`${g.departmentId}|${g.subDepartmentId ?? ""}`, ref.id);
      }
      sheetIds.push(ref.id);
      for (const a of g.students) {
        writer.set(recordsCol(db, collegeId).doc(recordId(ref.id, a.student.id)), {
          collegeId, batchId: ref.id, courseKey: meta.courseKey,
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
    }
    await writer.commit();

    await writeAuditLogSafe(db, collegeId, {
      action: "SEMESTER_RESULTS_IMPORTED",
      performedBy: session.uid,
      performedByName: name,
      targetId: sheetIds[0],
      details: { sheets: sheetIds, ...(uploadId ? { uploadId } : {}), title: batchTitle(meta), students: accepted.length, subjectRows, refusedRows: failed.length },
    });
    return NextResponse.json({
      dryRun: false, batchId: sheetIds[0], batchIds: sheetIds, uploadId: uploadId ?? null,
      students: accepted.length, subjectRows, failed, zeroCreditCodes, groups: groupSummary, otherBatch,
    }, { status: 201 });
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
