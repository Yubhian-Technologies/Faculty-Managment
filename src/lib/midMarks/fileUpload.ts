import { groupError, partTotal, type QuestionSheet } from "@/lib/exams/questionMarks";
import { NOT_ATTEMPTED, type MidFormatComponent, type MidQuestionValue, type MidSectionQuestion } from "@/types/midMarks";
import { questionsFromHeaders, sheetFromFormat } from "./format";

// Exam Cell > Mid Marks > Upload Mid Files (pure, browser + server). One workbook per subject per section, as the
// college keeps them: a sheet per component of the Mid exam format, named like it ("Descriptive", "Quiz",
// "Course Activity", "Day to Day Work"):
//   Student Registration No | Name | Subject Code | Subject Name | Q1 | Q2(A) | Q2(B) | ... | Total (30)
//   Student Registration No | Name | Subject Code | Subject Name | Course Activity (10)           <- one-number sheet
// A box: a mark, "-" (not attempted), "AB" (absent - the whole row), or empty. Our total of each sheet must equal
// its Total column, so a typing slip in a question box is caught before anything is saved.

export type Cell = number | "-" | "AB" | null | "BAD";
export interface RawSheet { name: string; rows: unknown[][] }
export interface RawWorkbook { fileName: string; sheets: RawSheet[] }

export interface ParsedSheet {
  name: string;
  /** Value column headings (question / item columns; empty for a one-number sheet). */
  labels: string[];
  /** The "(30)" of the last heading, when given. */
  headerMax: number | null;
  rows: { rowNo: number; roll: string; cells: Cell[]; total: Cell }[];
}
export interface ParsedWorkbook { fileName: string; subjectCode: string; sheets: ParsedSheet[] }

const FIXED = 4;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown };
    if (o.richText) return o.richText.map((t) => t.text).join("").trim();
    if ("result" in o) return text(o.result);
    if (typeof o.text === "string") return o.text.trim();
  }
  return String(v).trim();
};

export function cellOf(v: unknown): Cell {
  if (typeof v === "number") return Number.isFinite(v) ? v : "BAD";
  const s = text(v);
  if (!s) return null;
  if (s === "-" || s === "–" || s === "—") return "-";
  if (/^(ab|a|absent)$/i.test(s)) return "AB";
  const n = Number(s);
  return Number.isFinite(n) ? n : "BAD";
}

/** Reads one workbook's sheets; the subject code comes from the "Subject Code" column (else the file name). */
export function parseWorkbook(wb: RawWorkbook): ParsedWorkbook | { error: string } {
  const sheets: ParsedSheet[] = [];
  let code = "";
  for (const sh of wb.sheets) {
    const rows = sh.rows.map((r) => r ?? []);
    const at = rows.findIndex((r) => norm(text(r[0])).startsWith("studentregistration") || norm(text(r[0])).startsWith("regdno"));
    if (at < 0) {
      if (rows.every((r) => r.every((c) => !text(c)))) continue;
      return { error: `Sheet "${sh.name}": the first column must be "Student Registration No".` };
    }
    const header = rows[at].map(text);
    let last = header.length;
    while (last > 0 && !header[last - 1]) last -= 1;
    const value = header.slice(FIXED, last);
    if (value.length === 0) return { error: `Sheet "${sh.name}" has no marks columns.` };
    const maxM = value[value.length - 1].match(/\((\d+(?:\.\d+)?)\)\s*$/);
    const single = value.length === 1;
    const labels = single ? [] : value.slice(0, -1);
    const out: ParsedSheet = { name: sh.name.trim(), labels, headerMax: maxM ? Number(maxM[1]) : null, rows: [] };
    rows.forEach((r, i) => {
      if (i <= at) return;
      const roll = text(r[0]).toUpperCase();
      if (!roll) return;
      if (!code && text(r[2])) code = text(r[2]).toUpperCase();
      const cells = (single ? [r[FIXED]] : labels.map((_, j) => r[FIXED + j])).map(cellOf);
      out.rows.push({ rowNo: i + 1, roll, cells, total: cellOf(r[FIXED + value.length - 1]) });
    });
    sheets.push(out);
  }
  if (!sheets.length) return { error: "The file has no marks sheets." };
  if (!code) code = (wb.fileName.split(/[_\s.]/)[0] ?? "").toUpperCase();
  return { fileName: wb.fileName, subjectCode: code, sheets };
}

export interface StudentMarks {
  roll: string;
  q: Record<string, MidQuestionValue>;
  abParts: string[];
  absent: boolean;
  /** Each component's total as worked out here (null = nothing entered). */
  totals: Record<string, number | "AB" | null>;
}
export interface FilePlan {
  /** Per QUESTIONS component: the questions from the column headings (COs still to be set). */
  questions: Record<string, MidSectionQuestion[]>;
  sheet: QuestionSheet;
  students: StudentMarks[];
  errors: string[];
  notes: string[];
}

/**
 * Matches a parsed workbook to the format's components (by sheet name) and turns each row into marks on the sheet
 * built from the file's own questions. Every problem is listed (row-level ones with the Regd. No); a file with any
 * error must not be saved.
 */
export function planFile(p: ParsedWorkbook, components: MidFormatComponent[]): FilePlan {
  const errors: string[] = [];
  const notes: string[] = [];
  const bySheet = new Map<string, ParsedSheet>();
  for (const c of components) {
    const s = p.sheets.find((x) => norm(x.name) === norm(c.name));
    if (!s) { errors.push(`No "${c.name}" sheet in the file.`); continue; }
    bySheet.set(c.id, s);
    if (s.headerMax != null && s.headerMax !== c.max) errors.push(`"${s.name}" is out of ${s.headerMax}; the format has ${c.name} out of ${c.max}.`);
  }
  const extra = p.sheets.filter((s) => !components.some((c) => norm(c.name) === norm(s.name)));
  if (extra.length) notes.push(`Sheet${extra.length === 1 ? "" : "s"} not in the format, left out: ${extra.map((s) => `"${s.name}"`).join(", ")}.`);

  const questions: Record<string, MidSectionQuestion[]> = {};
  for (const c of components) {
    const s = bySheet.get(c.id);
    if (!s) continue;
    if (c.kind === "QUESTIONS") {
      const r = questionsFromHeaders(s.labels);
      if ("error" in r) { errors.push(`"${s.name}": ${r.error}`); continue; }
      if (r.questions.length !== c.questions) { errors.push(`"${s.name}" has ${r.questions.length} questions; the format has ${c.questions}.`); continue; }
      questions[c.id] = r.questions;
    } else if (c.kind === "ITEMS") {
      if (s.labels.length !== c.items) errors.push(`"${s.name}" has ${s.labels.length} columns; the format has ${c.items} items.`);
    } else if (s.labels.length !== 0) errors.push(`"${s.name}" must have one marks column.`);
  }
  const sheet = sheetFromFormat({ components, questions });
  if (errors.length) return { questions, sheet, students: [], errors, notes };

  // Every Regd. No in any sheet, in the order first seen.
  const rolls: string[] = [];
  const seen = new Set<string>();
  for (const c of components) for (const r of bySheet.get(c.id)!.rows) if (!seen.has(r.roll)) { seen.add(r.roll); rolls.push(r.roll); }
  const dup = components.flatMap((c) => {
    const s = bySheet.get(c.id)!;
    const n = new Map<string, number>();
    s.rows.forEach((r) => n.set(r.roll, (n.get(r.roll) ?? 0) + 1));
    return [...n].filter(([, k]) => k > 1).map(([roll]) => `${roll} is in "${s.name}" more than once.`);
  });
  errors.push(...dup);

  const students: StudentMarks[] = [];
  for (const roll of rolls) {
    const q: Record<string, MidQuestionValue> = {};
    const abParts: string[] = [];
    const totals: Record<string, number | "AB" | null> = {};
    const problems: string[] = [];
    for (const c of components) {
      const s = bySheet.get(c.id)!;
      const row = s.rows.find((r) => r.roll === roll);
      const part = sheet.parts.find((x) => x.id === c.id)!;
      const cols = sheet.columns.filter((x) => x.partId === c.id);
      if (!row) { problems.push(`not in "${s.name}"`); cols.forEach((x) => { q[x.key] = null; }); totals[c.id] = null; continue; }
      const cells = row.cells;
      const ab = cells.filter((x) => x === "AB").length;
      if (ab > 0 || (row.total === "AB" && cells.every((x) => x == null || x === "-"))) {
        if (ab > 0 && ab < cells.filter((x) => x != null).length) { problems.push(`"${s.name}" has AB with marks`); continue; }
        abParts.push(c.id); cols.forEach((x) => { q[x.key] = null; }); totals[c.id] = "AB";
        continue;
      }
      const values: Record<string, number | null> = {};
      cols.forEach((col, i) => {
        const v = cells[i];
        if (v === "BAD") { problems.push(`${s.name} ${col.label} is not a number`); q[col.key] = null; return; }
        if (typeof v === "number") {
          if (v < 0 || v > col.max) problems.push(`${s.name} ${col.label} is ${v} (0 to ${col.max})`);
          else if (!Number.isInteger(v * 2)) problems.push(`${s.name} ${col.label}: whole or half marks only`);
        }
        q[col.key] = v === "-" ? NOT_ATTEMPTED : (v as number | null);
        values[col.key] = typeof v === "number" ? v : null;
      });
      const g = groupError({ ...sheet, parts: [part], columns: cols }, values);
      if (g) problems.push(`${s.name}: ${g}`);
      const t = cols.every((col) => q[col.key] == null) ? null : partTotal(part, Object.fromEntries(cols.map((col) => [col.key, values[col.key] ?? 0])));
      totals[c.id] = t;
      if (t == null) problems.push(`no marks in "${s.name}"`);
      else if (typeof row.total === "number" && row.total !== t) problems.push(`${s.name} total in the file is ${row.total}, the marks add up to ${t}`);
      else if (row.total === "AB") problems.push(`${s.name} total is AB but marks are entered`);
    }
    if (problems.length) { errors.push(`${roll}: ${problems.join("; ")}.`); continue; }
    const absent = abParts.length === components.length;
    students.push({ roll, q, abParts: absent ? [] : abParts, absent, totals });
  }
  const partAb = students.filter((s) => !s.absent && s.abParts.length);
  if (partAb.length) notes.push(`${partAb.length} student${partAb.length === 1 ? " is" : "s are"} AB in some components only: ${partAb.slice(0, 5).map((s) => s.roll).join(", ")}${partAb.length > 5 ? " ..." : ""}.`);
  return { questions, sheet, students, errors, notes };
}
