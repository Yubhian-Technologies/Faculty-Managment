// The one row-validation rulebook for Academics > Course Structure. Pure
// (no Firestore, no DOM) so the page's Preview and the server's
// CourseStructureImportService run the exact same checks against the exact
// same scope - a row the Preview marks OK is a row the server accepts, and
// vice versa. The server stays the authority (it re-derives the scope from
// Firestore itself, then re-runs this inside the commit transaction), the
// page only uses it to surface problems before anything is sent.
//
// All-or-nothing contract: `ok` is true only when EVERY row is valid. The
// importer never writes a partial file.
import { SUBJECT_CATEGORY_LABELS, type SubjectCategory, type SubjectType } from "@/types";
import { resolveSubjectType } from "./normalize";

// Each row can cost up to two writes (a new master subject + its semester
// instance) and the whole file commits in one transaction, which this repo
// keeps within Firestore's 500-writes-per-commit convention.
export const COURSE_STRUCTURE_MAX_ROWS = 250;

export const COURSE_STRUCTURE_REQUIRED_KEYS = [
  "year", "semester", "category", "name", "lectureHours", "tutorialHours", "practicalHours",
] as const;

// What the selected Department is actually allowed to receive for the
// selected Course - built by the server (CourseStructureImportService.loadContext)
// and handed to the page, never re-derived client-side.
export interface CourseStructureScope {
  durationYears: number;
  // Ordinal years this department teaches this course (teachableYearsForDepartment).
  teachableYears: number[];
  // Year -> semester numbers configured in Course-Year Timings for this course.
  semestersByYear: Record<number, number[]>;
}

export type CourseStructureRawRow = Record<string, string | number | null | undefined>;

export interface CourseStructureRowInput {
  // The row's real position in the uploaded sheet (header = row 1), so every
  // message points at the row the user actually sees in Excel.
  rowNumber: number;
  data: CourseStructureRawRow;
}

export interface CourseStructureIssue {
  row: number;
  field?: string;
  message: string;
}

export interface CourseStructureRow {
  rowNumber: number;
  year: number;
  semester: number;
  name: string;
  code: string;
  codeSource: "file" | "derived";
  shortCode?: string;
  category: SubjectCategory;
  customCategory?: string;
  type: SubjectType;
  lectureHours: number;
  tutorialHours: number;
  practicalHours: number;
  hoursPerWeek: number;
  credits: number;
  internalMarks?: number;
  externalMarks?: number;
  totalMarks?: number;
}

export interface CourseStructureValidationResult {
  ok: boolean;
  rows: CourseStructureRow[];
  errors: CourseStructureIssue[];
  warnings: CourseStructureIssue[];
}

function text(v: CourseStructureRawRow[string]): string {
  return v == null ? "" : String(v).trim();
}

function normalizeWords(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };

// "2", "2.0", "II", "Year 2", "2nd", "Sem 3", "III Semester" -> the integer;
// anything else (0, 1.5, "two", "A") -> null.
export function parseOrdinal(raw: CourseStructureRawRow[string]): number | null {
  if (text(raw).startsWith("-")) return null;
  const s = normalizeWords(text(raw))
    .replace(/\b(year|yr|semester|sem)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  if (ROMAN[s] != null) return ROMAN[s];
  const m = /^(\d+)(?:st|nd|rd|th)?(?: 0+)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseNonNegative(raw: CourseStructureRawRow[string]): number | undefined | "invalid" {
  const s = text(raw);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : "invalid";
}

// Same derivation the page's old single-row fix dialog and
// MasterSubjectImportService used, kept identical so a file re-imported
// without a Subject Code column still matches the codes it produced before.
export function deriveSubjectCode(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 10);
}

// ── Category ────────────────────────────────────────────────────────────
const CATEGORY_LOOKUP = new Map<string, SubjectCategory>();
for (const [key, label] of Object.entries(SUBJECT_CATEGORY_LABELS)) {
  CATEGORY_LOOKUP.set(normalizeWords(key), key);
  CATEGORY_LOOKUP.set(normalizeWords(label), key);
  // "Professional Core (PCC)" is also typed as just "Professional Core".
  CATEGORY_LOOKUP.set(normalizeWords(label.replace(/\([^)]*\)/g, "")), key);
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

type CategoryResolution =
  | { kind: "known"; category: SubjectCategory }
  | { kind: "custom"; category: SubjectCategory }
  | { kind: "typo"; suggestion: SubjectCategory };

// Strict counterpart of normalize.ts's resolveSubjectCategory: a known
// category (key or label), a near-miss of one (a typo - rejected with a
// suggestion instead of silently becoming a brand-new category), or a
// deliberately custom category (kept, with a warning).
export function resolveImportCategory(raw: string): CategoryResolution {
  const norm = normalizeWords(raw);
  const known = CATEGORY_LOOKUP.get(norm);
  if (known) return { kind: "known", category: known };
  for (const [candidate, key] of CATEGORY_LOOKUP) {
    if (candidate.length <= 4) {
      // Short codes: only a dropped/doubled letter ("PCCC", "PC") counts as a
      // typo. A same-length substitution is usually a real, different code
      // ("SEC" - Skill Enhancement Course - is not a typo of "BSC").
      if (Math.abs(candidate.length - norm.length) === 1 && editDistance(candidate, norm) === 1) {
        return { kind: "typo", suggestion: key };
      }
    } else if (Math.abs(candidate.length - norm.length) <= 2 && editDistance(candidate, norm) <= 2) {
      return { kind: "typo", suggestion: key };
    }
  }
  return { kind: "custom", category: raw.trim() };
}

// Two rows (or a row and an existing master) describe the same subject.
export function sameSubjectIdentity(
  a: Pick<CourseStructureRow, "name" | "category" | "lectureHours" | "tutorialHours" | "practicalHours">,
  b: Pick<CourseStructureRow, "name" | "category" | "lectureHours" | "tutorialHours" | "practicalHours">
): boolean {
  return normalizeWords(a.name) === normalizeWords(b.name)
    && String(a.category).toUpperCase() === String(b.category).toUpperCase()
    && a.lectureHours === b.lectureHours
    && a.tutorialHours === b.tutorialHours
    && a.practicalHours === b.practicalHours;
}

export function missingRequiredColumns(mappedKeys: Iterable<string>): string[] {
  const have = new Set(mappedKeys);
  return COURSE_STRUCTURE_REQUIRED_KEYS.filter((k) => !have.has(k));
}

export function validateCourseStructureRows(
  inputs: CourseStructureRowInput[],
  scope: CourseStructureScope
): CourseStructureValidationResult {
  const errors: CourseStructureIssue[] = [];
  const warnings: CourseStructureIssue[] = [];
  const rows: CourseStructureRow[] = [];
  const teachable = new Set(scope.teachableYears);

  if (inputs.length === 0) {
    errors.push({ row: 0, message: "The file has no data rows." });
  }
  if (inputs.length > COURSE_STRUCTURE_MAX_ROWS) {
    errors.push({ row: 0, message: `A single import can hold at most ${COURSE_STRUCTURE_MAX_ROWS} rows. This file has ${inputs.length}. Split it by year.` });
  }

  for (const { rowNumber, data } of inputs) {
    const rowErrors: CourseStructureIssue[] = [];
    const err = (field: string, message: string) => rowErrors.push({ row: rowNumber, field, message });
    const warn = (field: string, message: string) => warnings.push({ row: rowNumber, field, message });

    // Year / Semester - and whether this department may receive them.
    const year = parseOrdinal(data.year);
    const semester = parseOrdinal(data.semester);
    if (!text(data.year)) err("year", "Year is required.");
    else if (year == null) err("year", `Year "${text(data.year)}" isn't a valid year number.`);
    else if (year > scope.durationYears) err("year", `Year ${year} is beyond this course's ${scope.durationYears}-year duration.`);
    else if (!teachable.has(year)) {
      err("year", scope.teachableYears.length > 0
        ? `This department isn't assigned Year ${year} of this course (assigned: ${scope.teachableYears.map((y) => `Year ${y}`).join(", ")}).`
        : "This department has no years assigned for this course.");
    }
    if (!text(data.semester)) err("semester", "Semester is required.");
    else if (semester == null) err("semester", `Semester "${text(data.semester)}" isn't a valid semester number.`);
    else if (year != null && teachable.has(year)) {
      const allowed = scope.semestersByYear[year] ?? [];
      if (!allowed.includes(semester)) {
        err("semester", allowed.length > 0
          ? `Semester ${semester} isn't configured for Year ${year} (configured: ${allowed.join(", ")}).`
          : `Year ${year} has no semesters configured in Course-Year Timings.`);
      }
    }

    // Name / Code / Short Code
    const name = text(data.name).replace(/\s+/g, " ");
    if (!name) err("name", "Subject Name is required.");
    const fileCode = text(data.code).toUpperCase();
    const code = fileCode || deriveSubjectCode(name);
    if (!code) err("code", "Subject Code couldn't be derived. Add a Subject Code.");
    else if (!/^[A-Z0-9][A-Z0-9\-/.]*$/.test(code)) err("code", `Subject Code "${code}" may only contain letters, digits, "-", "/" and ".".`);
    const shortCode = text(data.shortCode).toUpperCase() || undefined;

    // Category
    const categoryRaw = text(data.category);
    let category: SubjectCategory | undefined;
    let customCategory: string | undefined;
    if (!categoryRaw) err("category", "Category is required.");
    else {
      const resolved = resolveImportCategory(categoryRaw);
      if (resolved.kind === "typo") err("category", `Category "${categoryRaw}" isn't recognised. Did you mean ${resolved.suggestion}?`);
      else {
        category = resolved.category;
        if (resolved.kind === "custom") warn("category", `"${categoryRaw}" isn't a standard category. It will be saved as a custom category.`);
      }
      if (category === "OTHER") {
        customCategory = text(data.customCategory) || undefined;
        if (!customCategory) err("customCategory", "Custom Category is required when Category is Other.");
      }
    }

    // L / T / P
    const lp = parseNonNegative(data.lectureHours);
    const tp = parseNonNegative(data.tutorialHours);
    const pp = parseNonNegative(data.practicalHours);
    for (const [field, label, v] of [["lectureHours", "L", lp], ["tutorialHours", "T", tp], ["practicalHours", "P", pp]] as const) {
      if (v === undefined) err(field, `${label} is required (use 0 if none).`);
      else if (v === "invalid") err(field, `${label} must be a number 0 or more.`);
    }
    const L = typeof lp === "number" ? lp : 0;
    const T = typeof tp === "number" ? tp : 0;
    const P = typeof pp === "number" ? pp : 0;
    const lptOk = typeof lp === "number" && typeof tp === "number" && typeof pp === "number";
    if (lptOk && L + T + P === 0) warn("lectureHours", "L, T and P are all 0. This subject won't take any timetable periods.");

    // Type (optional - inferred from L/T/P when absent, same as before)
    let type: SubjectType = P > 0 && L === 0 ? "PRACTICAL" : "THEORY";
    const typeRaw = text(data.type);
    if (typeRaw) {
      const t = resolveSubjectType(typeRaw);
      if (!t) err("type", `Type "${typeRaw}" isn't recognised (use Theory, Practical, Tutorial or Project).`);
      else type = t;
    }

    // Optional numerics
    const hpw = parseNonNegative(data.hoursPerWeek);
    const credits = parseNonNegative(data.credits);
    const internalMarks = parseNonNegative(data.internalMarks);
    const externalMarks = parseNonNegative(data.externalMarks);
    const totalMarks = parseNonNegative(data.totalMarks);
    if (hpw === "invalid") err("hoursPerWeek", "Weekly Hours must be a number 0 or more.");
    else if (typeof hpw === "number" && lptOk && hpw !== L + T + P) warn("hoursPerWeek", `Weekly Hours (${hpw}) differs from L+T+P (${L + T + P}).`);
    if (credits === "invalid") err("credits", "Credits must be a number 0 or more.");
    if (internalMarks === "invalid") err("internalMarks", "Internal Marks must be a number 0 or more.");
    if (externalMarks === "invalid") err("externalMarks", "External Marks must be a number 0 or more.");
    if (totalMarks === "invalid") err("totalMarks", "Total Marks must be a number 0 or more.");
    if (typeof internalMarks === "number" && typeof externalMarks === "number" && typeof totalMarks === "number"
      && internalMarks + externalMarks !== totalMarks) {
      err("totalMarks", `Internal (${internalMarks}) + External (${externalMarks}) doesn't equal Total (${totalMarks}).`);
    }

    if (rowErrors.length > 0 || year == null || semester == null || !category) {
      errors.push(...rowErrors);
      continue;
    }
    rows.push({
      rowNumber,
      year,
      semester,
      name,
      code,
      codeSource: fileCode ? "file" : "derived",
      shortCode,
      category,
      customCategory,
      type,
      lectureHours: L,
      tutorialHours: T,
      practicalHours: P,
      hoursPerWeek: typeof hpw === "number" ? hpw : L + T + P,
      credits: typeof credits === "number" ? credits : Math.round((L + T + P * 0.5) * 10) / 10,
      ...(typeof internalMarks === "number" ? { internalMarks } : {}),
      ...(typeof externalMarks === "number" ? { externalMarks } : {}),
      ...(typeof totalMarks === "number" ? { totalMarks } : {}),
    });
  }

  // ── Cross-row consistency ──────────────────────────────────────────────
  // One code = one subject. The same subject may legitimately appear in
  // more than one semester (a year-long subject), but never twice in the
  // same semester, and never as two different subjects under one code.
  const firstByCode = new Map<string, CourseStructureRow>();
  const seenSlot = new Map<string, CourseStructureRow>();
  const nameInSemester = new Map<string, CourseStructureRow>();
  const shortInSemester = new Map<string, CourseStructureRow>();
  for (const r of rows) {
    const first = firstByCode.get(r.code);
    if (!first) firstByCode.set(r.code, r);
    else if (!sameSubjectIdentity(first, r)) {
      errors.push({
        row: r.rowNumber,
        field: "code",
        message: r.codeSource === "derived" && first.codeSource === "derived"
          ? `"${r.name}" and "${first.name}" (row ${first.rowNumber}) both produce the code ${r.code}. Add a Subject Code column with distinct codes.`
          : `Code ${r.code} is already used by row ${first.rowNumber} for a different subject ("${first.name}").`,
      });
      continue;
    }
    const slotKey = `${r.code}|${r.year}|${r.semester}`;
    const dup = seenSlot.get(slotKey);
    if (dup) {
      errors.push({ row: r.rowNumber, field: "code", message: `Duplicate of row ${dup.rowNumber} (same subject, Year ${r.year} Semester ${r.semester}).` });
      continue;
    }
    seenSlot.set(slotKey, r);

    const semKey = `${r.year}|${r.semester}`;
    const nameKey = `${semKey}|${normalizeWords(r.name)}`;
    const sameName = nameInSemester.get(nameKey);
    if (sameName && sameName.code !== r.code) {
      warnings.push({ row: r.rowNumber, field: "name", message: `Same name as row ${sameName.rowNumber} in Year ${r.year} Semester ${r.semester}, but a different code.` });
    } else nameInSemester.set(nameKey, r);
    if (r.shortCode) {
      const shortKey = `${semKey}|${r.shortCode}`;
      const sameShort = shortInSemester.get(shortKey);
      if (sameShort && sameShort.code !== r.code) {
        warnings.push({ row: r.rowNumber, field: "shortCode", message: `Short Code ${r.shortCode} is also used by row ${sameShort.rowNumber} in this semester. The timetable won't tell them apart.` });
      } else shortInSemester.set(shortKey, r);
    }
  }

  const failedRows = new Set(errors.map((e) => e.row));
  return {
    ok: errors.length === 0,
    rows: rows.filter((r) => !failedRows.has(r.rowNumber)),
    errors: errors.sort((a, b) => a.row - b.row),
    warnings: warnings.sort((a, b) => a.row - b.row),
  };
}
