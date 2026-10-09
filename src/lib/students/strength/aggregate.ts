import { cleanLabel, isKnownStatus, normKey, normStatus, statusRule, STATUS_RULES, UNSET_LABELS } from "./config";
import type {
  BranchMeta,
  DuplicateRoll,
  ProgramMeta,
  SectionMeta,
  StatusMeta,
  StrengthCell,
  StrengthHealth,
  StrengthMeta,
  StrengthRow,
} from "./types";

// Reference data the engine reads alongside the students. All of it is the
// college's ordinary configuration (Courses / Departments / Sections screens)
// - the engine never owns a list of its own, so a new department, program,
// year or section shows up in the dashboard the moment it is configured.

export interface CatalogCourse {
  id: string;
  name?: string;
  departmentId?: string;
  durationYears?: number;
  isActive?: boolean;
}

export interface CatalogDepartment {
  id: string;
  name?: string;
  code?: string;
  isActive?: boolean;
  hasSubDepartments?: boolean;
  parentRunsOwnSections?: boolean;
  managedDepartments?: string[];
  /**
   * The other field a college may hold the same "I run a shared year for these
   * branches" relationship in - the cross-listing. VISHNU WOMEN'S UNIVERSITY
   * and YUBHIAN configure it this way; VISHNU INSTITUTE OF TECHNOLOGY uses
   * managedDepartments. No department anywhere uses both.
   */
  secondaryDepartments?: string[];
  assignedYears?: number[];
  courseScopes?: Record<string, { assignedYears?: number[]; secondaryDepartments?: string[] }>;
}

/** The branches a department groups, from either field it may be configured in. */
export function groupedBranchNames(d: Pick<CatalogDepartment, "managedDepartments" | "secondaryDepartments" | "courseScopes">): string[] {
  const perCourse = Object.values(d.courseScopes ?? {}).flatMap((s) => s.secondaryDepartments ?? []);
  return [...(d.managedDepartments ?? []), ...(d.secondaryDepartments ?? []), ...perCourse]
    .map((n) => cleanLabel(n))
    .filter(Boolean);
}

export interface CatalogSection {
  department?: string;
  courseId?: string;
  courseName?: string;
  name?: string;
  year?: number;
}

export interface StrengthCatalog {
  courses: CatalogCourse[];
  departments: CatalogDepartment[];
  sections: CatalogSection[];
}

/**
 * The branch a student counts under - exactly ONE, so no student is ever
 * counted in two departments.
 *
 * A shared-first-year student is FILED under the common/feeder department
 * (e.g. "Basic Science - Maths") while `secondaryDepartment` names the real
 * branch they are headed for (see StudentRecord.secondaryDepartment); on
 * promotion that field is cleared and `department` becomes the branch. So
 * "which branch is this student in" is `secondaryDepartment` when set, else
 * `department` - the same rule the spreadsheet's per-branch "I Year" column
 * uses. Both are dedicated database fields; nothing is parsed from names or
 * roll numbers.
 */
export function effectiveBranchName(row: Pick<StrengthRow, "department" | "secondaryDepartment">): string {
  return cleanLabel(row.secondaryDepartment) || cleanLabel(row.department);
}

const SEP = "\u0001";

function yearOf(row: StrengthRow): number {
  const n = Number(row.year);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** First label wins; a configured (catalog) label is set up-front so it always beats free text on a student. */
function remember(labels: Map<string, string>, key: string, label: string) {
  if (label && !labels.has(key)) labels.set(key, label);
}

export interface StrengthBuild {
  cells: StrengthCell[];
  meta: StrengthMeta;
  health: StrengthHealth;
}

/**
 * The GROUP BY. One pass over the students -> one cell per distinct
 * (program, branch, year, section, status, batch) with its count. Because a
 * student is a single row with a single value in each dimension, every
 * student lands in exactly one cell: a student can never be counted in two
 * sections, and sum(cells) always equals the number of students scanned.
 *
 * Students are identified only by their document id here - two students who
 * share a name (or even a roll number) are still two rows, two counts.
 */
export function buildStrengthCube(rows: StrengthRow[], catalog: StrengthCatalog): StrengthBuild {
  const courseById = new Map<string, CatalogCourse>();
  for (const c of catalog.courses) courseById.set(c.id, c);
  const deptById = new Map<string, CatalogDepartment>();
  for (const d of catalog.departments) deptById.set(d.id, d);

  const programLabels = new Map<string, string>();
  const branchLabels = new Map<string, string>();
  const sectionLabels = new Map<string, string>();
  const batchLabels = new Map<string, string>();

  // Configured labels first, so "Bachelor Of Technology" (the Course doc)
  // beats a stray "BACHELOR OF TECHNOLOGY" typed on one student.
  for (const c of catalog.courses) remember(programLabels, normKey(c.name), cleanLabel(c.name));
  for (const d of catalog.departments) remember(branchLabels, normKey(d.name), cleanLabel(d.name));

  const programOf = (row: StrengthRow): { key: string; label: string } => {
    const fromDoc = row.courseId ? courseById.get(row.courseId) : undefined;
    const label = cleanLabel(fromDoc?.name) || cleanLabel(row.course);
    return { key: normKey(label), label };
  };

  const cellMap = new Map<string, StrengthCell>();
  const rollHolders = new Map<string, { roll: string; holders: { id: string; name: string }[] }>();
  const observedStatuses = new Set<string>();
  const observedYears = new Set<number>();

  const health: StrengthHealth = {
    totalRecords: rows.length,
    duplicateRolls: [],
    enrolledWithoutSection: 0,
    enrolledWithoutProgram: 0,
    enrolledWithoutYear: 0,
    enrolledUnknownBranch: 0,
    unrecognizedStatus: 0,
  };

  const knownBranchKeys = new Set(catalog.departments.map((d) => normKey(d.name)));

  for (const row of rows) {
    const program = programOf(row);
    remember(programLabels, program.key, program.label);

    const branchName = effectiveBranchName(row);
    const branch = normKey(branchName);
    remember(branchLabels, branch, branchName);

    const year = yearOf(row);
    if (year) observedYears.add(year);

    const sectionLabel = cleanLabel(row.section);
    const section = normKey(sectionLabel);
    remember(sectionLabels, section, sectionLabel);

    const batchLabel = cleanLabel(row.batch);
    const batch = normKey(batchLabel);
    remember(batchLabels, batch, batchLabel);

    const status = normStatus(row.status);
    observedStatuses.add(status);

    const key = [program.key, branch, year, section, status, batch].join(SEP);
    const cell = cellMap.get(key);
    if (cell) cell.count += 1;
    else cellMap.set(key, { program: program.key, branch, year, section, status, batch, count: 1 });

    // ── data health (same pass) ──
    const enrolled = statusRule(status).countsInStrength;
    if (!isKnownStatus(status)) health.unrecognizedStatus += 1;
    if (enrolled) {
      if (!section) health.enrolledWithoutSection += 1;
      if (!program.key) health.enrolledWithoutProgram += 1;
      if (!year) health.enrolledWithoutYear += 1;
      if (!branch || !knownBranchKeys.has(branch)) health.enrolledUnknownBranch += 1;
    }
    const rk = normKey(row.rollNumber);
    if (rk) {
      const entry = rollHolders.get(rk) ?? { roll: cleanLabel(row.rollNumber), holders: [] };
      entry.holders.push({ id: row.id, name: cleanLabel(row.name) });
      rollHolders.set(rk, entry);
    }
  }

  const duplicateRolls: DuplicateRoll[] = [];
  for (const { roll, holders } of rollHolders.values()) {
    if (holders.length > 1) duplicateRolls.push({ roll, count: holders.length, holders: holders.slice(0, 10) });
  }
  duplicateRolls.sort((a, b) => b.count - a.count || a.roll.localeCompare(b.roll));
  health.duplicateRolls = duplicateRolls.slice(0, 100);

  // ── metadata ──────────────────────────────────────────────────────────
  const activeDepts = catalog.departments.filter((d) => d.isActive !== false);

  const branchesByCourseProgram = new Map<string, Set<string>>();
  const durationByProgram = new Map<string, number>();
  for (const c of catalog.courses) {
    if (c.isActive === false) continue;
    const pk = normKey(c.name);
    if (!pk) continue;
    durationByProgram.set(pk, Math.max(durationByProgram.get(pk) ?? 0, Number(c.durationYears) || 0));
    const dept = c.departmentId ? deptById.get(c.departmentId) : undefined;
    if (dept && dept.isActive !== false) {
      const set = branchesByCourseProgram.get(pk) ?? new Set<string>();
      set.add(normKey(dept.name));
      branchesByCourseProgram.set(pk, set);
    }
  }

  const programKeys = new Set<string>([...durationByProgram.keys()]);
  for (const cell of cellMap.values()) programKeys.add(cell.program);
  const programs: ProgramMeta[] = [...programKeys]
    .map((key) => ({
      key,
      label: programLabels.get(key) || UNSET_LABELS.program,
      durationYears: durationByProgram.get(key) ?? 0,
      branchKeys: [...(branchesByCourseProgram.get(key) ?? [])],
    }))
    .sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : a.label.localeCompare(b.label)));

  const branchMap = new Map<string, BranchMeta>();
  for (const d of activeDepts) {
    const key = normKey(d.name);
    if (!key || branchMap.has(key)) continue;
    branchMap.set(key, {
      key,
      label: cleanLabel(d.name),
      code: cleanLabel(d.code),
      // A department that groups branches is a feeder however that grouping is
      // configured. Reading managedDepartments alone meant BASIC SCIENCE -
      // ENGLISH, which cross-lists instead, was offered as a Department of its
      // own - a choice that can only come back 0, since its students are all
      // counted under the branch they are headed for.
      isFeeder: (d.hasSubDepartments === true && d.parentRunsOwnSections === false) || groupedBranchNames(d).length > 0,
      unknown: false,
    });
  }
  for (const cell of cellMap.values()) {
    if (!branchMap.has(cell.branch)) {
      branchMap.set(cell.branch, { key: cell.branch, label: branchLabels.get(cell.branch) || UNSET_LABELS.branch, code: "", isFeeder: false, unknown: true });
    }
  }
  const branches = [...branchMap.values()].sort((a, b) => a.label.localeCompare(b.label));

  const sections: SectionMeta[] = [];
  for (const s of catalog.sections) {
    const label = cleanLabel(s.name);
    if (!label) continue;
    remember(sectionLabels, normKey(label), label);
    const doc = s.courseId ? courseById.get(s.courseId) : undefined;
    const programName = cleanLabel(doc?.name) || cleanLabel(s.courseName);
    const year = Number(s.year);
    sections.push({
      program: normKey(programName),
      branch: normKey(s.department),
      year: Number.isFinite(year) && year > 0 ? Math.trunc(year) : 0,
      section: normKey(label),
      label,
    });
  }

  const statusMap = new Map<string, StatusMeta>(STATUS_RULES.map((s) => [s.key, s]));
  for (const key of observedStatuses) if (!statusMap.has(key)) statusMap.set(key, statusRule(key));

  const batches = [...batchLabels.entries()]
    .filter(([key]) => key !== "")
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => b.label.localeCompare(a.label));

  const maxYear = Math.max(0, ...observedYears, ...durationByProgram.values());

  return {
    cells: [...cellMap.values()],
    meta: { programs, branches, sections, sectionLabels: Object.fromEntries(sectionLabels), statuses: [...statusMap.values()], batches, maxYear },
    health,
  };
}
