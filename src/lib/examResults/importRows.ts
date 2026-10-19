// Turning an uploaded results sheet (one row per student per subject) into
// per-student result records, with a reason for every row that cannot be
// taken. Pure: the import route looks the students and subjects up and hands
// them in, so every rule here is testable without Firestore.

import type { ExamResultSubject, GradeRule } from "@/types/examResults";
import { normalizeGrade } from "./rules";

/** One row of the sheet, as the page sends it. `row` is its sheet row number. */
export interface RawResultRow {
  row: number;
  rollNumber?: unknown;
  subjectCode?: unknown;
  grade?: unknown;
  universitySgpa?: unknown;
}

export interface ResultStudent {
  id: string;
  rollNumber: string;
  name: string;
  department: string;
  /** A 1st-year's core branch while enrolled under a shared / Basic Science department. */
  secondaryDepartment?: string;
  courseId?: string;
  regulation?: string;
  /** The student's cohort ("2024-2028"; a lateral entrant's starts later, ends the same year). */
  batch?: string;
  /** Current year of study - works out the batch when none is stored (see effectiveBatchStart). */
  year?: number;
  /** The batch of the section the student is placed in, when any. */
  sectionBatch?: string;
}

/**
 * The intake year of a student's batch. A batch is stamped on the student only
 * when they are placed into a section, so many records (students imported but
 * not yet placed) carry none. Then it is worked out: the section's batch if
 * placed, else from the current year of study - a Year 2 student in 2026-27
 * started in 2025. Null when there is nothing to go on.
 */
export function effectiveBatch(student: Pick<ResultStudent, "batch" | "year" | "sectionBatch">, currentStartYear?: number): { batch: string; derived: boolean } | null {
  const own = String(student.batch ?? "").trim();
  if (own) return { batch: own, derived: false };
  const fromSection = String(student.sectionBatch ?? "").trim();
  if (fromSection) return { batch: fromSection, derived: true };
  const year = Number(student.year);
  if (currentStartYear && Number.isInteger(year) && year >= 1) {
    const start = currentStartYear - (year - 1);
    // Only the start year is compared (see batchMatches), so the end is a placeholder.
    return { batch: `${start}-`, derived: true };
  }
  return null;
}

export interface ResultSubjectOption {
  id: string;
  /** The college's code - what results are stored and shown under. */
  code: string;
  name: string;
  credits: number;
  courseId?: string;
  regulation?: string;
  academicYear?: string;
}

export interface FailedResultRow {
  row: number;
  rollNumber: string;
  subjectCode: string;
  error: string;
}

export interface AcceptedStudentResult {
  student: ResultStudent;
  subjects: ExamResultSubject[];
  /** Sheet row number of each entry of `subjects` (same order) - for error reports only, never stored. */
  rows: number[];
  /** REVALUATION only: the batch of the student's sitting being re-graded. */
  revaluesBatchId?: string;
  /** The University SGPA column, when the file has one: a number, or null for "-" (withheld). */
  universitySgpa?: number | null;
  /** The student's batch on record when it is not the sheet's (e.g. detained, or not yet
   *  moved): a note only - the result still goes to them, filed under the sheet's exam. */
  otherBatch?: string;
}

export interface ResultImportContext {
  /** Students of this college, by upper-case Regd. No. */
  students: Map<string, ResultStudent>;
  /** Subjects of this college, by upper-case college code (a key may have several entries). */
  subjects: Map<string, ResultSubjectOption[]>;
  gradeTable: GradeRule[];
  /** The Course docs of the batch's programme. Empty = not checked. */
  courseIds: string[];
  courseName: string;
  /** The sheet's branch: a student must belong to it (as department or core department). Empty = not checked. */
  department: string;
  /** The department names a student may carry: the branch and its sub-departments, or just the one
   *  sub-department picked. Absent = only `department`. */
  allowedDepartments?: string[];
  regulation: string;
  academicYear: string;
  /** The sheet's batch ("2024-2028"). Empty = not checked. */
  batch?: string;
  /** Students with results already filed under `batch` (any semester) - a detained
   *  student now in a later batch still belongs to this one for those exams (no note). */
  batchHistory?: Set<string>;
  /** The college's current academic year's start ("2026" for 2026-27) - for a student with no batch stored. */
  currentStartYear?: number;
}

/** A student's batch is the sheet's: the same, or (a lateral entrant) ending the same year. */
export function batchMatches(studentBatch: string | undefined, sheetBatch: string): boolean {
  const own = String(studentBatch ?? "").trim();
  if (!own) return false;
  if (own === sheetBatch) return true;
  // A batch worked out from the year of study knows only its start year.
  if (own.endsWith("-")) return own.slice(0, 4) === sheetBatch.slice(0, 4);
  const end = (b: string) => (/(\d{4})$/.exec(b) ?? [])[1];
  return !!end(own) && end(own) === end(sheetBatch);
}

/**
 * The batch is a NOTE, never a refusal: a result goes to the Regd. No's student whatever
 * batch they are in now (a detained student moved to a junior batch, or one detained but
 * not moved yet). The one stop is a file that is mostly another batch - then the batch
 * picked is probably wrong. Small files (Add rows of a few students) are never stopped.
 */
export function wrongBatchFile(accepted: AcceptedStudentResult[], sheetBatch: string): string | null {
  const others = accepted.filter((a) => a.otherBatch !== undefined);
  if (others.length < 5 || others.length * 2 <= accepted.length) return null;
  const count = new Map<string, number>();
  for (const a of others) count.set(a.otherBatch!, (count.get(a.otherBatch!) ?? 0) + 1);
  const [top] = [...count.entries()].sort((x, y) => y[1] - x[1]);
  return `${others.length} of ${accepted.length} students are not in batch ${sheetBatch} on record` +
    (top[0] ? ` (most are ${top[0]})` : "") + ` - check the batch picked for this file`;
}

export const rollKey = (v: unknown) => String(v ?? "").trim().toUpperCase();
export const subjectKey = (v: unknown) => String(v ?? "").trim().toUpperCase();

/**
 * The subject entry a code means for this student. The same code can exist
 * once per regulation / academic session, so the closest entry wins: the
 * student's own course, then the batch's regulation, then its academic year.
 */
export function pickSubject(options: ResultSubjectOption[], student: ResultStudent, ctx: Pick<ResultImportContext, "courseIds" | "regulation" | "academicYear">): ResultSubjectOption {
  return [...options].sort((a, b) => subjectScore(b, student, ctx) - subjectScore(a, student, ctx))[0];
}

function subjectScore(s: ResultSubjectOption, student: ResultStudent, ctx: Pick<ResultImportContext, "courseIds" | "regulation" | "academicYear">): number {
  const regulation = (ctx.regulation || student.regulation || "").trim().toUpperCase();
  return (s.courseId && s.courseId === student.courseId ? 8 : 0) +
    (s.courseId && ctx.courseIds.includes(s.courseId) ? 4 : 0) +
    (regulation && (s.regulation ?? "").trim().toUpperCase() === regulation ? 2 : 0) +
    (ctx.academicYear && s.academicYear === ctx.academicYear ? 1 : 0);
}

export function validateResultRows(
  rows: RawResultRow[],
  ctx: ResultImportContext
): { accepted: AcceptedStudentResult[]; failed: FailedResultRow[] } {
  const grades = new Map(ctx.gradeTable.map((g) => [normalizeGrade(g.grade), g]));
  const byStudent = new Map<string, AcceptedStudentResult>();
  const seen = new Set<string>();
  const failed: FailedResultRow[] = [];

  for (const raw of rows) {
    const rollNumber = String(raw.rollNumber ?? "").trim();
    const subjectCode = String(raw.subjectCode ?? "").trim();
    const fail = (error: string) => failed.push({ row: raw.row, rollNumber: rollNumber || "-", subjectCode: subjectCode || "-", error });

    if (!rollNumber) { fail("Regd. No is required"); continue; }
    if (!subjectCode) { fail("Subject Code is required"); continue; }
    const gradeText = normalizeGrade(raw.grade);
    if (!gradeText) { fail("Grade is required"); continue; }

    const student = ctx.students.get(rollKey(rollNumber));
    if (!student) { fail(`No student with Regd. No "${rollNumber}" in this college`); continue; }
    if (ctx.courseIds.length > 0 && student.courseId && !ctx.courseIds.includes(student.courseId)) {
      fail(`${rollNumber} is not a ${ctx.courseName} student`);
      continue;
    }
    // Batch: noted, never refused (see wrongBatchFile).
    let otherBatch: string | undefined;
    if (ctx.batch && !ctx.batchHistory?.has(student.id)) {
      const eff = effectiveBatch(student, ctx.currentStartYear);
      if (!eff) otherBatch = "";
      else if (!batchMatches(eff.batch, ctx.batch)) otherBatch = eff.derived && !student.sectionBatch ? `Year ${student.year} now (${eff.batch.slice(0, 4)}-)` : eff.batch;
    }
    const allowed = (ctx.allowedDepartments ?? (ctx.department ? [ctx.department] : [])).map((d) => d.trim().toLowerCase()).filter(Boolean);
    if (allowed.length > 0 && ![student.department, student.secondaryDepartment].some((d) => allowed.includes((d ?? "").trim().toLowerCase()))) {
      const what = ctx.allowedDepartments?.length === 1 ? ctx.allowedDepartments[0] : ctx.department;
      fail(`${rollNumber} is not a ${what} student (${student.department || "no branch on record"})`);
      continue;
    }

    const options = ctx.subjects.get(subjectKey(subjectCode));
    if (!options || options.length === 0) { fail(`Subject Code "${subjectCode}" is not a subject of this college`); continue; }

    const subject = pickSubject(options, student, ctx);
    // A code naming two different subjects equally well is refused, never guessed.
    const best = options.filter((o) => o.code.trim().toUpperCase() !== subject.code.trim().toUpperCase()
      && subjectScore(o, student, ctx) === subjectScore(subject, student, ctx));
    if (best.length > 0) {
      fail(`Subject Code "${subjectCode}" matches more than one subject (${[subject, ...best].map((o) => `${o.code} ${o.name}`).join("; ")})`);
      continue;
    }
    // Zero-credit subjects (mandatory / audit courses) have no grade points -
    // only Pass or Fail. Any grade the file gives is a Pass, except one marked
    // as failing in the grade table (F, AB, MP, WH ...), which is a Fail.
    // Credit subjects must use the grade table.
    const credits = Number.isFinite(subject.credits) && subject.credits > 0 ? subject.credits : 0;
    let result: { grade: string; points: number; isPass: boolean; gradeAsGiven?: string };
    if (credits === 0) {
      const isPass = grades.get(gradeText)?.isPass !== false;
      result = { grade: isPass ? "Pass" : "Fail", points: 0, isPass, gradeAsGiven: gradeText };
    } else {
      const grade = grades.get(gradeText);
      if (!grade) {
        fail(`Grade "${gradeText}" is not in the grade table (${ctx.gradeTable.map((g) => g.grade).join(", ")})`);
        continue;
      }
      // A failing grade never carries points into the formula.
      result = { grade: grade.grade, points: grade.isPass ? grade.points : 0, isPass: grade.isPass };
    }

    // Keyed by the subject itself.
    const dupKey = `${student.id}::${subject.id}`;
    if (seen.has(dupKey)) { fail(`${rollNumber} already has a row for ${subjectCode} in this file`); continue; }
    seen.add(dupKey);
    const entry: AcceptedStudentResult = byStudent.get(student.id) ?? { student, subjects: [], rows: [] };
    entry.rows.push(raw.row);
    if (otherBatch !== undefined) entry.otherBatch = otherBatch;
    // The university's SGPA: the first row of the student that carries one.
    const uni = String(raw.universitySgpa ?? "").trim();
    if (uni && entry.universitySgpa === undefined) {
      const n = Number(uni);
      entry.universitySgpa = Number.isFinite(n) ? n : /^[-–—]+$|^n\/?a$/i.test(uni) ? null : undefined;
    }
    entry.subjects.push({
      subjectId: subject.id,
      subjectCode: subject.code.trim() || subjectCode,
      subjectName: subject.name,
      credits,
      ...result,
    });
    byStudent.set(student.id, entry);
  }

  return { accepted: [...byStudent.values()], failed };
}

/** A student's results already on record for the same course and semester, in other batches. */
export interface PriorResult {
  studentId: string;
  batchId: string;
  examType: "REGULAR" | "SUPPLEMENTARY" | "REVALUATION";
  /** REVALUATION only: the batch it re-grades. */
  revaluesBatchId?: string;
  /** The cohort the result was filed under ("2024-2028"). */
  batch?: string;
  /** Import time (ms) - picks the latest of two matching sittings. */
  at?: number;
  /** "2026-27". */
  academicYear: string;
  /** Only a PUBLISHED earlier result can be re-sat (a draft may still be deleted). */
  status: "DRAFT" | "PUBLISHED";
  /** "2026-11" - the month the exam was held (matches a picked exam across branches). */
  examHeld?: string;
  subjects: { subjectCode: string; isPass: boolean }[];
}

/**
 * The rules that need a student's earlier results for this semester:
 *  - Regular: one Regular result per student per semester - a student who
 *    already has one in another batch is refused (delete that draft, or use a
 *    Supplementary sheet, instead).
 *  - Supplementary: only for a subject the student has a PUBLISHED earlier
 *    result for, has not passed yet, and sat in this academic year or before
 *    (a re-sit can never come before the exam it re-sits).
 */
export function applyPriorResults(
  accepted: AcceptedStudentResult[],
  prior: PriorResult[],
  examType: "REGULAR" | "SUPPLEMENTARY" | "REVALUATION",
  semester: number,
  academicYear = "",
  opts: { batch?: string; targetBatchId?: string; targetByStudent?: Map<string, string> } = {}
): { accepted: AcceptedStudentResult[]; failed: FailedResultRow[] } {
  const startOf = (ay: string) => Number(String(ay).slice(0, 4)) || 0;
  const byStudent = new Map<string, PriorResult[]>();
  for (const p of prior) byStudent.set(p.studentId, [...(byStudent.get(p.studentId) ?? []), p]);
  const failed: FailedResultRow[] = [];
  const kept: AcceptedStudentResult[] = [];

  for (const a of accepted) {
    const earlier = byStudent.get(a.student.id) ?? [];
    if (examType === "REGULAR") {
      // One Regular per semester per batch: a detained student re-registered in
      // a later batch writes the Regular exam again under that batch.
      if (earlier.some((p) => p.examType === "REGULAR" && (!opts.batch || !p.batch || p.batch === opts.batch))) {
        a.subjects.forEach((s, i) => failed.push({
          row: a.rows[i], rollNumber: a.student.rollNumber, subjectCode: s.subjectCode,
          error: `${a.student.rollNumber} already has Regular results for Semester ${semester} in another sheet`,
        }));
        continue;
      }
      kept.push(a);
      continue;
    }
    const seen = new Set<string>();
    const passed = new Set<string>();
    const unpublished = new Set<string>();
    // The earliest academic year each subject was sat in (published sittings).
    const firstSat = new Map<string, string>();
    for (const p of earlier) for (const s of p.subjects) {
      const code = subjectKey(s.subjectCode);
      if (p.status !== "PUBLISHED") { unpublished.add(code); continue; }
      seen.add(code);
      if (s.isPass) passed.add(code);
      const first = firstSat.get(code);
      if (!first || startOf(p.academicYear) < startOf(first)) firstSat.set(code, p.academicYear);
    }
    const subjects: ExamResultSubject[] = [];
    const rows: number[] = [];
    a.subjects.forEach((s, i) => {
      const code = subjectKey(s.subjectCode);
      const fail = (error: string) => failed.push({ row: a.rows[i], rollNumber: a.student.rollNumber, subjectCode: s.subjectCode, error });
      if (!seen.has(code)) {
        return fail(unpublished.has(code)
          ? `${a.student.rollNumber}'s earlier result for ${s.subjectCode} is not published yet - publish it first`
          : `${a.student.rollNumber} has no earlier result for ${s.subjectCode} in Semester ${semester}`);
      }
      if (passed.has(code)) return fail(`${a.student.rollNumber} has already passed ${s.subjectCode}`);
      const targetId = opts.targetByStudent ? opts.targetByStudent.get(a.student.id) : opts.targetBatchId;
      if (opts.targetBatchId || opts.targetByStudent) {
        const target = targetId ? earlier.find((p) => p.batchId === targetId) : undefined;
        if (!target) return fail(`${a.student.rollNumber} has no result in the picked exam`);
        if (!target.subjects.some((x) => subjectKey(x.subjectCode) === code)) return fail(`${s.subjectCode} is not in ${a.student.rollNumber}'s picked exam`);
      }
      const first = firstSat.get(code) ?? "";
      if (academicYear && first && startOf(academicYear) < startOf(first)) {
        return fail(`A ${academicYear} supplementary cannot come before ${a.student.rollNumber}'s ${first} exam in ${s.subjectCode}`);
      }
      subjects.push(s);
      rows.push(a.rows[i]);
    });
    if (subjects.length > 0) kept.push({ ...a, subjects, rows });
  }
  return { accepted: kept, failed };
}

/**
 * Revaluation sheets re-grade subjects of ONE picked, published exam: every
 * student must have a result in it, every subject must be in that result, and
 * a subject is revalued once per exam. A passed subject may be revalued too -
 * the better of the two grades counts (gpa.ts applyRevaluations), so nothing
 * here compares grades.
 */
export function applyRevaluationTargets(
  accepted: AcceptedStudentResult[],
  prior: PriorResult[],
  /** One sheet for everyone, or each student's own sheet of the exam (an upload of every branch). */
  target: string | Map<string, string>,
  examLabel: string
): { accepted: AcceptedStudentResult[]; failed: FailedResultRow[] } {
  const failed: FailedResultRow[] = [];
  const kept: AcceptedStudentResult[] = [];
  for (const a of accepted) {
    const mine = prior.filter((p) => p.studentId === a.student.id);
    const targetBatchId = typeof target === "string" ? target : target.get(a.student.id) ?? "";
    const own = mine.find((p) => p.batchId === targetBatchId);
    if (!own) {
      a.subjects.forEach((s, i) => failed.push({ row: a.rows[i], rollNumber: a.student.rollNumber, subjectCode: s.subjectCode, error: `${a.student.rollNumber} has no result in ${examLabel}` }));
      continue;
    }
    const inTarget = new Set(own.subjects.map((s) => subjectKey(s.subjectCode)));
    const revalued = new Set(mine
      .filter((p) => p.examType === "REVALUATION" && p.revaluesBatchId === targetBatchId)
      .flatMap((p) => p.subjects.map((s) => subjectKey(s.subjectCode))));
    const subjects: ExamResultSubject[] = [];
    const rows: number[] = [];
    a.subjects.forEach((s, i) => {
      const code = subjectKey(s.subjectCode);
      const fail = (error: string) => failed.push({ row: a.rows[i], rollNumber: a.student.rollNumber, subjectCode: s.subjectCode, error });
      if (!inTarget.has(code)) return fail(`${s.subjectCode} is not in ${a.student.rollNumber}'s ${examLabel} result`);
      if (revalued.has(code)) return fail(`${a.student.rollNumber}'s ${examLabel} ${s.subjectCode} has already been revalued`);
      subjects.push(s);
      rows.push(a.rows[i]);
    });
    if (subjects.length > 0) kept.push({ ...a, subjects, rows, revaluesBatchId: targetBatchId });
  }
  return { accepted: kept, failed };
}

/** A department as the grouping needs it. */
export interface DepartmentRef {
  id: string;
  name: string;
  parentDepartmentId?: string;
}

/** One sheet of an every-branch upload: a branch, or one of its sub-departments. */
export interface BranchGroup {
  department: string;
  departmentId: string;
  subDepartment?: string;
  subDepartmentId?: string;
  students: AcceptedStudentResult[];
}

/**
 * Splits an every-branch upload into one sheet per branch - and one per
 * sub-department - from each student's own record:
 *  - a student with a core department (a 1st year enrolled under a shared /
 *    Basic Science department) goes under that core department;
 *  - a student in a sub-department gets that sub-department's own sheet, filed
 *    under its parent branch;
 *  - anyone else, their department's sheet.
 * A student whose department isn't one of the college's is refused.
 */
export function groupByBranch(
  accepted: AcceptedStudentResult[],
  departments: DepartmentRef[]
): { groups: BranchGroup[]; failed: FailedResultRow[] } {
  const byName = new Map(departments.map((d) => [d.name.trim().toLowerCase(), d]));
  const byId = new Map(departments.map((d) => [d.id, d]));
  const groups = new Map<string, BranchGroup>();
  const failed: FailedResultRow[] = [];
  for (const a of accepted) {
    const own = (a.student.secondaryDepartment || a.student.department || "").trim();
    const dept = byName.get(own.toLowerCase());
    if (!dept) {
      a.subjects.forEach((s, i) => failed.push({
        row: a.rows[i], rollNumber: a.student.rollNumber, subjectCode: s.subjectCode,
        error: own ? `${a.student.rollNumber}'s department "${own}" is not one of the college's departments` : `${a.student.rollNumber} has no department on record`,
      }));
      continue;
    }
    const parent = dept.parentDepartmentId ? byId.get(dept.parentDepartmentId) : undefined;
    const g = parent
      ? { department: parent.name, departmentId: parent.id, subDepartment: dept.name, subDepartmentId: dept.id }
      : { department: dept.name, departmentId: dept.id };
    const k = `${g.departmentId}|${g.subDepartmentId ?? ""}`;
    const entry = groups.get(k) ?? { ...g, students: [] };
    entry.students.push(a);
    groups.set(k, entry);
  }
  return {
    groups: [...groups.values()].sort((x, y) => `${x.department} ${x.subDepartment ?? ""}`.localeCompare(`${y.department} ${y.subDepartment ?? ""}`)),
    failed,
  };
}
