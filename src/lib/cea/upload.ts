import type { CeaWhen } from "@/types/cea";

// CIE marks upload - pure. One section (teaching assignment), every planned unit at once: a mark per student per
// unit (0..unit marks, halves allowed) or AB (Absent = 0); a blank cell leaves that mark as it is. In-class units
// carry the date held (a with-Mid unit takes the Mid's). Everything is checked first; nothing is saved while any
// problem remains. Saved units stay DRAFT - the faculty member checks them and presses Submit.

export interface UploadUnit { unit: number; when: CeaWhen; unitMarks: number; status: "DRAFT" | "SUBMITTED" | null; heldOn?: string | null }
export interface UploadStudent { studentId: string; rollNumber: string; name: string }
export interface UploadRow { roll: string; marks: Record<string, string | number | null | undefined> }
export interface UnitChange { unit: number; heldOn?: string; values: { studentId: string; marks: number | null; absent?: true }[] }
export interface UploadPlan {
  errors: string[];
  unknownRolls: string[];
  /** Units in the file that are already submitted - left as they are. */
  skippedSubmitted: number[];
  changes: UnitChange[];
  marksGiven: number;
}

const ROLL = (s: string) => s.trim().toUpperCase().replace(/[\s-]+/g, "");

/** One cell: blank (leave as is), AB (absent), a mark, or not valid. */
export function parseCieCell(v: unknown, unitMarks: number): { kind: "blank" } | { kind: "absent" } | { kind: "marks"; n: number } | { kind: "bad" } {
  if (v === null || v === undefined) return { kind: "blank" };
  const s = String(v).trim();
  if (!s) return { kind: "blank" };
  if (/^(ab|a|absent)$/i.test(s)) return { kind: "absent" };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > unitMarks || !Number.isInteger(n * 2)) return { kind: "bad" };
  return { kind: "marks", n };
}

/** "YYYY-MM-DD", "DD/MM/YYYY" or "DD-MM-YYYY" -> "YYYY-MM-DD"; "" when blank; null when not a real date. */
export function normalizeHeldOn(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return "";
  let y: number, m: number, d: number;
  let mm = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (mm) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
  else if ((mm = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s))) { d = +mm[1]; m = +mm[2]; y = +mm[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function planCieUpload(input: {
  units: UploadUnit[];
  students: UploadStudent[];
  rows: UploadRow[];
  heldOn?: Record<string, unknown>;
  today?: string;
}): UploadPlan {
  const errors: string[] = [];
  const unknownRolls: string[] = [];
  const skippedSubmitted: number[] = [];
  const byRoll = new Map(input.students.filter((s) => s.rollNumber).map((s) => [ROLL(s.rollNumber), s]));
  const seen = new Set<string>();
  const perUnit = new Map<number, Map<string, { marks: number | null; absent?: true }>>();
  let marksGiven = 0;

  for (const row of input.rows) {
    const roll = String(row.roll ?? "").trim();
    if (!roll) continue;
    const st = byRoll.get(ROLL(roll));
    if (!st) { unknownRolls.push(roll); continue; }
    if (seen.has(st.studentId)) { errors.push(`${roll}: listed twice in the file`); continue; }
    seen.add(st.studentId);
    for (const u of input.units) {
      const cell = parseCieCell(row.marks[String(u.unit)], u.unitMarks);
      if (cell.kind === "blank") continue;
      if (cell.kind === "bad") { errors.push(`${roll}, Unit ${u.unit}: "${row.marks[String(u.unit)]}" - give 0 to ${u.unitMarks} (halves allowed) or AB`); continue; }
      if (u.status === "SUBMITTED") { if (!skippedSubmitted.includes(u.unit)) skippedSubmitted.push(u.unit); continue; }
      const m = perUnit.get(u.unit) ?? new Map();
      m.set(st.studentId, cell.kind === "absent" ? { marks: 0, absent: true } : { marks: cell.n });
      perUnit.set(u.unit, m);
      marksGiven += 1;
    }
  }

  const changes: UnitChange[] = [];
  for (const u of input.units) {
    const values = perUnit.get(u.unit);
    const rawDate = input.heldOn?.[String(u.unit)];
    const date = u.when === "CLASS" ? normalizeHeldOn(rawDate) : "";
    if (u.when === "CLASS" && date === null) { errors.push(`Unit ${u.unit}: the Date Held "${rawDate}" is not a date (use DD/MM/YYYY)`); continue; }
    if (date && input.today && date > input.today) { errors.push(`Unit ${u.unit}: the Date Held can't be in the future`); continue; }
    if (!values || u.status === "SUBMITTED") continue;
    if (u.when === "CLASS" && !date && !u.heldOn) { errors.push(`Unit ${u.unit} is held in class - give its Date Held in the template's Date Held row`); continue; }
    changes.push({ unit: u.unit, ...(date ? { heldOn: date } : {}), values: [...values].map(([studentId, v]) => ({ studentId, ...v })) });
  }
  if (marksGiven === 0 && errors.length === 0 && unknownRolls.length === 0 && skippedSubmitted.length === 0) errors.push("The file has no marks to upload.");
  skippedSubmitted.sort((a, b) => a - b);
  return { errors, unknownRolls, skippedSubmitted, changes, marksGiven };
}
