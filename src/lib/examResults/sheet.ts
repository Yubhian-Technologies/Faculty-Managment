// The results sheet's columns, and the details of one results batch (which
// exam it is). Pure - shared by the import page and the import API.

import { matchHeaders, normalizeHeader } from "@/lib/utils/csv";
import type { ExamResultType } from "@/types/examResults";

export const RESULT_COLUMNS = [
  { key: "rollNumber", label: "Roll No", required: true, aliases: ["Roll Number", "Roll.No", "Regd No", "Reg No", "Regno", "Registration No", "Hall Ticket No", "HT No", "HTNO"] },
  { key: "subjectCode", label: "Subject Code", required: true, aliases: ["Sub Code", "Subcode", "Course Code", "Paper Code", "Subject.Code"] },
  { key: "grade", label: "Grade", required: true, aliases: ["Grade Letter", "Grades", "Letter Grade", "Grade Secured", "Grade Obtained"] },
  // Optional: the university's own SGPA for the student (any one row of theirs
  // is enough). Never used in the calculation - only compared with ours.
  { key: "universitySgpa", label: "University SGPA", required: false, aliases: ["SGPA", "SCGPA", "SGPA Secured", "Semester GPA"] },
] as const;

export type ResultColumnKey = (typeof RESULT_COLUMNS)[number]["key"];

/**
 * Header row -> column-index map. Columns that are not one of RESULT_COLUMNS
 * (Sl.No, Student Name, Subject Name, Credits, marks, Result ...) are reported back
 * as ignored rather than refusing the file: results sheets carry them, and the
 * system takes names and credits from its own records instead.
 */
export function resolveResultHeaders(headers: string[]): {
  keyMap: Record<number, ResultColumnKey>;
  missing: string[];
  ignored: string[];
} {
  const keyMap = matchHeaders(headers, RESULT_COLUMNS.map((c) => ({ key: c.key, label: c.label, aliases: [...c.aliases] }))) as Record<number, ResultColumnKey>;
  // One field, one column: a second column landing on the same field is ignored.
  const taken = new Set<string>();
  for (const i of Object.keys(keyMap).map(Number).sort((a, b) => a - b)) {
    if (taken.has(keyMap[i])) delete keyMap[i];
    else taken.add(keyMap[i]);
  }
  const missing = RESULT_COLUMNS.filter((c) => c.required && !taken.has(c.key)).map((c) => c.label);
  const ignored = headers
    .map((h, i) => (h.trim() && !keyMap[i] && normalizeHeader(h) ? h.trim() : null))
    .filter((h): h is string => h !== null);
  return { keyMap, missing, ignored };
}

/** What a batch IS - picked once on the import page, for the whole sheet. */
export interface ResultBatchMeta {
  courseKey: string;
  courseName: string;
  courseIds: string[];
  department: string;
  departmentId: string;
  /** Optional: one sub-department of the branch (students of only that sub-department). */
  subDepartment?: string;
  subDepartmentId?: string;
  regulation: string;
  /** The student cohort, as configured on the regulation ("2024-2028"). */
  batch: string;
  /** Derived, never picked: Regular from batch + year; Supplementary from the exam date; Revaluation from its exam. */
  academicYear: string;
  year: number;
  semester: number;
  examType: ExamResultType;
  /** Month the exam was held, "YYYY-MM" (a Revaluation takes its exam's). */
  examHeld: string;
  /** Supplementary: the exam it re-sits. Revaluation: the exam it re-grades. Both must be published. */
  targetBatchId?: string;
  /** REVALUATION only: the type of the exam it re-grades (taken from that exam). */
  revaluationOf?: "REGULAR" | "SUPPLEMENTARY";
}

const BATCH = /^\d{4}-\d{4}$/;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11" -> "Nov 2026" ("" for anything else). */
export function examHeldLabel(ym: string | undefined): string {
  const m = MONTH.exec(String(ym ?? ""));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
}

/** The academic year a Regular exam of `year` belongs to for `batch`: 2024-2028, Year 2 -> "2025-26". */
export function regularAcademicYear(batch: string, year: number): string {
  const start = Number(batch.slice(0, 4)) + year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export interface MetaContext {
  /** This month, "YYYY-MM" - an exam can't be held after it. */
  currentMonth: string;
  /** The college's academic year a month falls in ("2026-11" -> "2026-27"). */
  academicYearOfMonth: (ym: string) => string;
}

/**
 * The picked exam details, checked and completed. A Revaluation's date,
 * academic year and type come from the exam it re-grades, so the import route
 * fills them in after loading that exam (see completeFromTarget).
 */
export function normalizeBatchMeta(input: unknown, ctx: MetaContext): { meta: ResultBatchMeta } | { error: string } {
  const b = (input ?? {}) as Partial<Record<keyof ResultBatchMeta, unknown>>;
  const courseKey = String(b.courseKey ?? "").trim();
  const courseName = String(b.courseName ?? "").trim();
  const courseIds = Array.isArray(b.courseIds)
    ? [...new Set(b.courseIds.map((x) => String(x ?? "").trim()).filter(Boolean))]
    : [];
  if (!courseKey || !courseName || courseIds.length === 0) return { error: "Choose a course" };
  if (courseIds.length > 30) return { error: "Too many course entries for one programme" };
  const regulation = String(b.regulation ?? "").trim().toUpperCase();
  if (!regulation) return { error: "Choose a regulation" };
  if (regulation.length > 20) return { error: "Regulation is too long" };
  const batch = String(b.batch ?? "").trim();
  if (!BATCH.test(batch)) return { error: "Choose a batch" };
  const department = String(b.department ?? "").trim();
  const departmentId = String(b.departmentId ?? "").trim();
  if (!department || !departmentId) return { error: "Choose a branch" };
  const subDepartment = String(b.subDepartment ?? "").trim();
  const subDepartmentId = String(b.subDepartmentId ?? "").trim();
  if (!!subDepartment !== !!subDepartmentId) return { error: "Choose the sub-department again" };
  const year = Number(b.year);
  if (!Number.isInteger(year) || year < 1 || year > 10) return { error: "Choose a year" };
  const batchLength = Number(batch.slice(5)) - Number(batch.slice(0, 4));
  if (batchLength > 0 && year > batchLength) return { error: `Batch ${batch} has no Year ${year}` };
  const semester = Number(b.semester);
  if (!Number.isInteger(semester) || semester < 1 || semester > 30) return { error: "Choose a semester" };
  const examType = b.examType === "SUPPLEMENTARY" || b.examType === "REGULAR" || b.examType === "REVALUATION" ? b.examType : null;
  if (!examType) return { error: "Choose Regular, Supplementary or Revaluation" };
  const base = {
    courseKey, courseName, courseIds, department, departmentId, regulation, batch, year, semester,
    ...(subDepartmentId ? { subDepartment, subDepartmentId } : {}),
  };

  if (examType === "REVALUATION") {
    const targetBatchId = String(b.targetBatchId ?? "").trim();
    if (!targetBatchId) return { error: "Choose the exam being revalued" };
    // Date, academic year and type are the revalued exam's - filled in by completeFromTarget.
    return { meta: { ...base, examType, targetBatchId, examHeld: "", academicYear: "" } };
  }

  const examHeld = String(b.examHeld ?? "").trim();
  if (!MONTH.test(examHeld)) return { error: "Choose the month the exam was held" };
  if (examHeld > ctx.currentMonth) return { error: `${examHeldLabel(examHeld)} hasn't come yet - choose the month the exam was held` };

  if (examType === "REGULAR") {
    const academicYear = regularAcademicYear(batch, year);
    const examYear = ctx.academicYearOfMonth(examHeld);
    if (Number(examYear.slice(0, 4)) < Number(academicYear.slice(0, 4))) {
      return { error: `A ${examHeldLabel(examHeld)} exam is before ${academicYear}, when batch ${batch} is in Year ${year} - check the batch, year or date` };
    }
    return { meta: { ...base, examType, examHeld, academicYear } };
  }

  const targetBatchId = String(b.targetBatchId ?? "").trim();
  if (!targetBatchId) return { error: "Choose the exam this supplementary is for" };
  return { meta: { ...base, examType, examHeld, academicYear: ctx.academicYearOfMonth(examHeld), targetBatchId } };
}

/** The exam a Supplementary / Revaluation points at, as the import route loads it. */
export interface TargetExam {
  status: "DRAFT" | "PUBLISHED";
  courseKey: string;
  batch?: string;
  departmentId?: string;
  subDepartmentId?: string;
  year: number;
  semester: number;
  examType: ExamResultType;
  examHeld?: string;
  academicYear: string;
}

/** Checks the picked exam belongs to this sheet's class and completes a Revaluation from it. */
export function completeFromTarget(meta: ResultBatchMeta, target: TargetExam | null): { meta: ResultBatchMeta } | { error: string } {
  if (!target) return { error: "The picked exam was not found" };
  if (target.status !== "PUBLISHED") return { error: "The picked exam is not published yet - publish it first" };
  if (target.examType === "REVALUATION") return { error: "Pick a Regular or Supplementary exam" };
  // An exam of the whole branch covers its sub-departments too; one sub-department's exam only that one.
  const subOk = !target.subDepartmentId || target.subDepartmentId === meta.subDepartmentId;
  if (target.courseKey !== meta.courseKey || target.batch !== meta.batch || target.departmentId !== meta.departmentId
    || target.year !== meta.year || target.semester !== meta.semester || !subOk) {
    return { error: "The picked exam is for a different course, batch, branch, year or semester" };
  }
  if (meta.examType === "REVALUATION") {
    return { meta: { ...meta, examHeld: target.examHeld ?? "", academicYear: target.academicYear, revaluationOf: target.examType } };
  }
  if (meta.examType === "SUPPLEMENTARY" && target.examHeld && meta.examHeld <= target.examHeld) {
    return { error: `A supplementary must be held after the exam it re-sits (${examHeldLabel(target.examHeld)})` };
  }
  return { meta };
}

/** "B.Tech · CSE · R23 · 2024-2028 · Year 2 · Semester 3 · Supplementary · May 2027". */
export function batchTitle(m: ResultBatchMeta): string {
  return [
    m.courseName,
    m.department,
    m.subDepartment || null,
    m.regulation || null,
    m.batch || m.academicYear,
    `Year ${m.year}`,
    `Semester ${m.semester}`,
    m.examType === "SUPPLEMENTARY" ? "Supplementary"
      : m.examType === "REVALUATION" ? `Revaluation of ${m.revaluationOf === "SUPPLEMENTARY" ? "Supplementary" : "Regular"}`
      : "Regular",
    examHeldLabel(m.examHeld) || null,
  ].filter(Boolean).join(" · ");
}
