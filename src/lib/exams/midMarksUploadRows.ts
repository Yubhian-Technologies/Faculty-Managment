import { cleanLayout, sheetFromLayout, type MidMarksLayout } from "@/lib/exams/midMarksEntry";
import { paperTotal, questionMarksError } from "@/lib/exams/questionMarks";

// The Exam Cell's Mid marks sheet (pure, browser + server). Layout of the Excel file:
//   Regd. No | Name | Section | Absent | <question 1> | <question 2> | ...      <- header row
//   Max Marks |      |         |        | 5            | 5            | ...      <- the Exam Cell's max per question
//   Paper Max | 25   |                                                           <- the paper's total (choices)
//   23XX1A0501 | ... | A       |        | 4            | 3.5          | ...      <- one row per student
// "Absent": Y / AB / Yes (marks left blank). A blank mark = not answered. Students are matched by Regd. No.

export const FIXED_HEADERS = ["Regd. No", "Name", "Section", "Absent"] as const;

export interface UploadRow { rowNo: number; roll: string; absent: boolean; values: Record<string, number | null> }
export interface ParsedUpload { layoutRaw: { questions: { label: string; max: number }[]; paperMax: number | null }; rows: UploadRow[] }

const text = (v: unknown) => (v == null ? "" : String(typeof v === "object" && v && "result" in v ? (v as { result: unknown }).result : v).trim());
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Reads the sheet's cells (rows of values, as exceljs gives them, 0-based). */
export function parseUploadSheet(cells: unknown[][]): ParsedUpload | { error: string } {
  const rows = cells.map((r) => (r ?? []).map(text));
  const headerAt = rows.findIndex((r) => norm(r[0] ?? "").startsWith("regdno"));
  if (headerAt < 0) return { error: "The first column's heading must be \"Regd. No\" - download the template and fill that." };
  const header = rows[headerAt];
  for (let i = 1; i < FIXED_HEADERS.length; i++) {
    if (norm(header[i] ?? "") !== norm(FIXED_HEADERS[i])) return { error: `Column ${i + 1} must be "${FIXED_HEADERS[i]}" - download the template and fill that.` };
  }
  const labels = header.slice(FIXED_HEADERS.length).filter((h, i, all) => h || all.slice(i).some(Boolean));
  if (!labels.length || labels.some((l) => !l)) return { error: "Name every question column (e.g. Q1, 2a) - a question column has no heading." };
  const maxRow = rows.find((r) => norm(r[0] ?? "") === "maxmarks");
  if (!maxRow) return { error: "The \"Max Marks\" row is missing - enter each question's max marks under its heading." };
  const paperRow = rows.find((r) => norm(r[0] ?? "") === "papermax");
  const questions = labels.map((label, i) => ({ label, max: Number(maxRow[FIXED_HEADERS.length + i]) }));
  const paperMax = paperRow && paperRow[1] ? Number(paperRow[1]) : null;
  const out: UploadRow[] = [];
  rows.forEach((r, i) => {
    if (i <= headerAt) return;
    const first = norm(r[0] ?? "");
    if (!first || first === "maxmarks" || first === "papermax") return;
    const absent = /^(y|yes|ab|absent|a)$/i.test(r[3] ?? "");
    const values: Record<string, number | null> = {};
    labels.forEach((label, j) => {
      const raw = r[FIXED_HEADERS.length + j] ?? "";
      values[label] = raw === "" || raw === "-" ? null : Number(raw);
    });
    out.push({ rowNo: i + 1, roll: (r[0] ?? "").toUpperCase(), absent, values });
  });
  return { layoutRaw: { questions, paperMax }, rows: out };
}

export interface RowCheck { rowNo: number; roll: string; error?: string; total?: number | null }

/** Each row against the layout: known student once, Absent with no marks, marks within the question / paper max. */
export function checkRows(layout: MidMarksLayout, rows: UploadRow[], knownRolls: Set<string>): RowCheck[] {
  const sheet = sheetFromLayout(layout);
  const seen = new Set<string>();
  return rows.map((r) => {
    const base = { rowNo: r.rowNo, roll: r.roll };
    if (!knownRolls.has(r.roll)) return { ...base, error: "Regd. No not found in this branch's sections for the subject." };
    if (seen.has(r.roll)) return { ...base, error: "This Regd. No appears more than once in the file." };
    seen.add(r.roll);
    const values = toKeys(layout, r.values);
    const filled = Object.values(values).some((v) => v != null);
    if (r.absent) return filled ? { ...base, error: "Marked Absent but has marks - leave the marks blank or clear Absent." } : { ...base, total: 0 };
    if (Object.values(values).some((v) => v != null && !Number.isFinite(v))) return { ...base, error: "A mark is not a number." };
    if (!filled) return { ...base, error: "No marks - enter the marks, or mark the student Absent." };
    const bad = questionMarksError(sheet, values);
    if (bad) return { ...base, error: bad };
    return { ...base, total: paperTotal(sheet, values) };
  });
}

/** The row's marks keyed like the sheet's columns (L1, L2 ... in the layout's order). */
export function toKeys(layout: MidMarksLayout, byLabel: Record<string, number | null>): Record<string, number | null> {
  return Object.fromEntries(layout.questions.map((q, i) => [`L${i + 1}`, byLabel[q.label] ?? null]));
}

/** The layout from the file's header rows, checked. */
export function layoutFromUpload(p: ParsedUpload): { layout: MidMarksLayout } | { error: string } {
  return cleanLayout({ questions: p.layoutRaw.questions, paperMax: p.layoutRaw.paperMax ?? undefined });
}

export function sameLayout(a: MidMarksLayout, b: MidMarksLayout): boolean {
  return a.paperMax === b.paperMax && a.questions.length === b.questions.length
    && a.questions.every((q, i) => q.label === b.questions[i].label && q.max === b.questions[i].max);
}
