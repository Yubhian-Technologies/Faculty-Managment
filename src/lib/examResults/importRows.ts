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
}

export interface ResultSubjectOption {
  id: string;
  /** The college's code - what results are stored and shown under. */
  code: string;
  /** The university's code (Subject.universityCode), when set. */
  universityCode?: string;
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
}

export interface ResultImportContext {
  /** Students of this college, by upper-case roll number. */
  students: Map<string, ResultStudent>;
  /** Subjects of this college, by upper-case college code AND by upper-case
   *  university code (a key may have several entries). */
  subjects: Map<string, ResultSubjectOption[]>;
  gradeTable: GradeRule[];
  /** The Course docs of the batch's programme. Empty = not checked. */
  courseIds: string[];
  courseName: string;
  /** The sheet's branch: a student must belong to it (as department or core department). Empty = not checked. */
  department: string;
  regulation: string;
  academicYear: string;
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

    if (!rollNumber) { fail("Roll No is required"); continue; }
    if (!subjectCode) { fail("Subject Code is required"); continue; }
    const gradeText = normalizeGrade(raw.grade);
    if (!gradeText) { fail("Grade is required"); continue; }

    const student = ctx.students.get(rollKey(rollNumber));
    if (!student) { fail(`No student with Roll No "${rollNumber}" in this college`); continue; }
    if (ctx.courseIds.length > 0 && student.courseId && !ctx.courseIds.includes(student.courseId)) {
      fail(`${rollNumber} is not a ${ctx.courseName} student`);
      continue;
    }
    const branch = ctx.department.trim().toLowerCase();
    if (branch && ![student.department, student.secondaryDepartment].some((d) => (d ?? "").trim().toLowerCase() === branch)) {
      fail(`${rollNumber} is not a ${ctx.department} student (${student.department || "no branch on record"})`);
      continue;
    }

    const options = ctx.subjects.get(subjectKey(subjectCode));
    if (!options || options.length === 0) { fail(`Subject Code "${subjectCode}" is not a subject of this college`); continue; }

    const grade = grades.get(gradeText);
    if (!grade) {
      fail(`Grade "${gradeText}" is not in the grade table (${ctx.gradeTable.map((g) => g.grade).join(", ")})`);
      continue;
    }

    const subject = pickSubject(options, student, ctx);
    // A code naming two different subjects equally well (a university code
    // given to two subjects of the same course) is refused, never guessed.
    const best = options.filter((o) => o.code.trim().toUpperCase() !== subject.code.trim().toUpperCase()
      && subjectScore(o, student, ctx) === subjectScore(subject, student, ctx));
    if (best.length > 0) {
      fail(`Subject Code "${subjectCode}" matches more than one subject (${[subject, ...best].map((o) => `${o.code} ${o.name}`).join("; ")}) - give the University Code to one subject only`);
      continue;
    }
    // Keyed by the subject itself, so its college code and university code
    // in two rows count as the same subject.
    const dupKey = `${student.id}::${subject.id}`;
    if (seen.has(dupKey)) { fail(`${rollNumber} already has a row for ${subjectCode} in this file`); continue; }
    seen.add(dupKey);
    const entry = byStudent.get(student.id) ?? { student, subjects: [], rows: [] };
    entry.rows.push(raw.row);
    entry.subjects.push({
      subjectId: subject.id,
      subjectCode: subject.code.trim() || subjectCode,
      subjectName: subject.name,
      credits: Number.isFinite(subject.credits) && subject.credits > 0 ? subject.credits : 0,
      grade: grade.grade,
      // A failing grade never carries points into the formula.
      points: grade.isPass ? grade.points : 0,
      isPass: grade.isPass,
    });
    byStudent.set(student.id, entry);
  }

  return { accepted: [...byStudent.values()], failed };
}

/** A student's results already on record for the same course and semester, in other batches. */
export interface PriorResult {
  studentId: string;
  batchId: string;
  examType: "REGULAR" | "SUPPLEMENTARY";
  subjects: { subjectCode: string; isPass: boolean }[];
}

/**
 * The rules that need a student's earlier results for this semester:
 *  - Regular: one Regular result per student per semester - a student who
 *    already has one in another batch is refused (delete that draft, or use a
 *    Supplementary sheet, instead).
 *  - Supplementary: only for a subject the student has an earlier result for
 *    and has not passed yet.
 */
export function applyPriorResults(
  accepted: AcceptedStudentResult[],
  prior: PriorResult[],
  examType: "REGULAR" | "SUPPLEMENTARY",
  semester: number
): { accepted: AcceptedStudentResult[]; failed: FailedResultRow[] } {
  const byStudent = new Map<string, PriorResult[]>();
  for (const p of prior) byStudent.set(p.studentId, [...(byStudent.get(p.studentId) ?? []), p]);
  const failed: FailedResultRow[] = [];
  const kept: AcceptedStudentResult[] = [];

  for (const a of accepted) {
    const earlier = byStudent.get(a.student.id) ?? [];
    if (examType === "REGULAR") {
      if (earlier.some((p) => p.examType === "REGULAR")) {
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
    for (const p of earlier) for (const s of p.subjects) {
      const code = subjectKey(s.subjectCode);
      seen.add(code);
      if (s.isPass) passed.add(code);
    }
    const subjects: ExamResultSubject[] = [];
    const rows: number[] = [];
    a.subjects.forEach((s, i) => {
      const code = subjectKey(s.subjectCode);
      const fail = (error: string) => failed.push({ row: a.rows[i], rollNumber: a.student.rollNumber, subjectCode: s.subjectCode, error });
      if (!seen.has(code)) return fail(`${a.student.rollNumber} has no earlier result for ${s.subjectCode} in Semester ${semester}`);
      if (passed.has(code)) return fail(`${a.student.rollNumber} has already passed ${s.subjectCode}`);
      subjects.push(s);
      rows.push(a.rows[i]);
    });
    if (subjects.length > 0) kept.push({ ...a, subjects, rows });
  }
  return { accepted: kept, failed };
}
