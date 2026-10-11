// The Exam Cell's Result Rules for a college: the grade table (per regulation,
// with a default) and when SGPA / CGPA may be shown. Pure - shared by the
// rules API, the import and the pages.

import { DEFAULT_GRADE_TABLE_KEY, type ExamResultRules, type GpaShowRule, type GradeRule } from "@/types/examResults";

const MAX_GRADES_PER_TABLE = 30;
const MAX_TABLES = 20;
const MAX_POINTS = 100;

/** A starting grade table, used until the Exam Cell saves its own. Absent,
 *  malpractice and withheld results are ordinary rows of the table - failing
 *  grades worth 0 - so a college can name them however its sheets do. */
export const STARTER_GRADE_TABLE: GradeRule[] = [
  { grade: "S", points: 10, isPass: true },
  { grade: "A", points: 9, isPass: true },
  { grade: "B", points: 8, isPass: true },
  { grade: "C", points: 7, isPass: true },
  { grade: "D", points: 6, isPass: true },
  { grade: "E", points: 5, isPass: true },
  { grade: "F", points: 0, isPass: false },
  { grade: "AB", points: 0, isPass: false },
  { grade: "MP", points: 0, isPass: false },
  { grade: "WH", points: 0, isPass: false },
];

export const STARTER_RULES: Pick<ExamResultRules, "gradeTables" | "showSgpa" | "showCgpa" | "decimals"> = {
  gradeTables: { [DEFAULT_GRADE_TABLE_KEY]: STARTER_GRADE_TABLE },
  showSgpa: "ALL_PASSED",
  showCgpa: "ALL_PASSED",
  decimals: 2,
};

/** A grade as it is compared everywhere: trimmed, upper-case ("a+" -> "A+"). */
export function normalizeGrade(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

/** A regulation code as a grade-table key ("r23 " -> "R23"). */
export function normalizeRegulation(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

/** The grade table for a regulation - its own, else the college's default. */
export function gradeTableFor(rules: Pick<ExamResultRules, "gradeTables">, regulation: string): GradeRule[] {
  const own = rules.gradeTables[normalizeRegulation(regulation)];
  return own && own.length > 0 ? own : rules.gradeTables[DEFAULT_GRADE_TABLE_KEY] ?? [];
}

const isShowRule = (v: unknown): v is GpaShowRule => v === "ALL_PASSED" || v === "ALWAYS";

function cleanTable(input: unknown, label: string): { table: GradeRule[] } | { error: string } {
  if (!Array.isArray(input)) return { error: `${label}: the grade table is missing` };
  if (input.length > MAX_GRADES_PER_TABLE) return { error: `${label}: at most ${MAX_GRADES_PER_TABLE} grades` };
  const seen = new Set<string>();
  const table: GradeRule[] = [];
  for (const raw of input as Partial<GradeRule>[]) {
    const grade = normalizeGrade(raw?.grade);
    if (!grade) return { error: `${label}: every row needs a grade` };
    if (grade.length > 10) return { error: `${label}: grade "${grade}" is too long (10 characters at most)` };
    if (seen.has(grade)) return { error: `${label}: grade "${grade}" is listed twice` };
    seen.add(grade);
    const points = Number(raw?.points);
    if (raw?.points === null || raw?.points === undefined || String(raw.points).trim() === "" || !Number.isFinite(points) || points < 0 || points > MAX_POINTS) {
      return { error: `${label}: grade "${grade}" needs points between 0 and ${MAX_POINTS}` };
    }
    table.push({ grade, points, isPass: raw?.isPass === true });
  }
  return { table };
}

/**
 * A request body as stored rules, or the reason it cannot be saved. The
 * default table must have at least one passing and one failing grade - with
 * no fail there is nothing for the "all passed" rules to act on.
 */
export function normalizeResultRules(
  input: unknown
): { rules: Pick<ExamResultRules, "gradeTables" | "showSgpa" | "showCgpa" | "decimals"> } | { error: string } {
  const body = (input ?? {}) as Partial<ExamResultRules>;
  if (!isShowRule(body.showSgpa)) return { error: "Choose when SGPA is shown" };
  if (!isShowRule(body.showCgpa)) return { error: "Choose when CGPA is shown" };
  const decimals = Number(body.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 4) return { error: "Decimals must be a whole number from 0 to 4" };

  const tablesIn = body.gradeTables;
  if (!tablesIn || typeof tablesIn !== "object" || Array.isArray(tablesIn)) return { error: "The grade table is missing" };
  const entries = Object.entries(tablesIn);
  if (entries.length > MAX_TABLES) return { error: `At most ${MAX_TABLES} grade tables` };

  const gradeTables: Record<string, GradeRule[]> = {};
  for (const [rawKey, rawTable] of entries) {
    const key = normalizeRegulation(rawKey);
    if (!key) return { error: "A grade table has no regulation name" };
    if (key.length > 20 || /[/.]/.test(key)) return { error: `"${key}" is not a usable regulation name` };
    if (gradeTables[key]) return { error: `Regulation "${key}" has two grade tables` };
    const label = key === DEFAULT_GRADE_TABLE_KEY ? "Default grade table" : `${key} grade table`;
    const cleaned = cleanTable(rawTable, label);
    if ("error" in cleaned) return cleaned;
    // A regulation left with no rows simply falls back to the default.
    if (cleaned.table.length === 0 && key !== DEFAULT_GRADE_TABLE_KEY) continue;
    gradeTables[key] = cleaned.table;
  }

  const fallback = gradeTables[DEFAULT_GRADE_TABLE_KEY] ?? [];
  if (!fallback.some((g) => g.isPass)) return { error: "The default grade table needs at least one passing grade" };
  if (!fallback.some((g) => !g.isPass)) return { error: "The default grade table needs at least one failing grade" };
  for (const [key, table] of Object.entries(gradeTables)) {
    if (!table.some((g) => g.isPass)) return { error: `${key} grade table needs at least one passing grade` };
  }
  return { rules: { gradeTables, showSgpa: body.showSgpa, showCgpa: body.showCgpa, decimals } };
}

/** Stored rules, or the starter ones for a college that has saved none yet. */
export function rulesOrStarter(stored: Partial<ExamResultRules> | undefined | null): ExamResultRules {
  const cleaned = stored ? normalizeResultRules(stored) : null;
  if (cleaned && "rules" in cleaned) return { ...(stored as ExamResultRules), ...cleaned.rules };
  return { ...STARTER_RULES };
}
