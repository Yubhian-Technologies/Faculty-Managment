// The results sheet's columns, and the details of one results batch (which
// exam it is). Pure - shared by the import page and the import API.

import { matchHeaders, normalizeHeader } from "@/lib/utils/csv";
import type { ExamResultType } from "@/types/examResults";

export const RESULT_COLUMNS = [
  { key: "rollNumber", label: "Roll No", required: true, aliases: ["Roll Number", "Roll.No", "Regd No", "Reg No", "Regno", "Registration No", "Hall Ticket No", "HT No", "HTNO"] },
  { key: "subjectCode", label: "Subject Code", required: true, aliases: ["Sub Code", "Subcode", "Course Code", "Paper Code", "Subject.Code"] },
  { key: "grade", label: "Grade", required: true, aliases: ["Grade Letter", "Grades", "Letter Grade", "Grade Secured", "Grade Obtained"] },
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
  regulation: string;
  academicYear: string;
  year: number;
  semester: number;
  examType: ExamResultType;
}

const ACADEMIC_YEAR = /^\d{4}-\d{2}$/;

export function normalizeBatchMeta(input: unknown): { meta: ResultBatchMeta } | { error: string } {
  const b = (input ?? {}) as Partial<Record<keyof ResultBatchMeta, unknown>>;
  const courseKey = String(b.courseKey ?? "").trim();
  const courseName = String(b.courseName ?? "").trim();
  const courseIds = Array.isArray(b.courseIds)
    ? [...new Set(b.courseIds.map((x) => String(x ?? "").trim()).filter(Boolean))]
    : [];
  if (!courseKey || !courseName || courseIds.length === 0) return { error: "Choose a course" };
  if (courseIds.length > 30) return { error: "Too many course entries for one programme" };
  const department = String(b.department ?? "").trim();
  const departmentId = String(b.departmentId ?? "").trim();
  if (!department || !departmentId) return { error: "Choose a branch" };
  const regulation = String(b.regulation ?? "").trim().toUpperCase();
  if (regulation.length > 20) return { error: "Regulation is too long" };
  const academicYear = String(b.academicYear ?? "").trim();
  if (!ACADEMIC_YEAR.test(academicYear)) return { error: "Choose an academic year" };
  const year = Number(b.year);
  if (!Number.isInteger(year) || year < 1 || year > 10) return { error: "Choose a year" };
  const semester = Number(b.semester);
  if (!Number.isInteger(semester) || semester < 1 || semester > 30) return { error: "Choose a semester" };
  const examType = b.examType === "SUPPLEMENTARY" ? "SUPPLEMENTARY" : b.examType === "REGULAR" ? "REGULAR" : null;
  if (!examType) return { error: "Choose Regular or Supplementary" };
  return { meta: { courseKey, courseName, courseIds, department, departmentId, regulation, academicYear, year, semester, examType } };
}

/** "Bachelor of Technology · CSE · R23 · 2026-27 · Year 1 · Semester 1 · Regular". */
export function batchTitle(m: ResultBatchMeta): string {
  return [
    m.courseName,
    m.department,
    m.regulation || null,
    m.academicYear,
    `Year ${m.year}`,
    `Semester ${m.semester}`,
    m.examType === "SUPPLEMENTARY" ? "Supplementary" : "Regular",
  ].filter(Boolean).join(" · ");
}
