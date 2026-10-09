import { managerEffectiveYears } from "@/lib/departments/hodScope";
import type { DepartmentYearRow } from "@/lib/departments/managedBranches";
import { resolveCatalogId } from "@/lib/college/academicStructure";
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
  /** The programme this Course doc is one department's copy of. */
  catalogId?: string;
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
  /**
   * The branch this section feeds, for a shared first year - stored plural for
   * legacy shape, but a section commits to one (see Section.secondaryDepartments).
   * Every student imported into it inherits it as their own
   * secondaryDepartment, which is what they are counted under.
   */
  secondaryDepartments?: string[];
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

/**
 * The same question, answered against the configuration: a student counts
 * under the branch they are headed for only for a year that branch actually
 * teaches. Otherwise they count under the department they are FILED in, which
 * is the one teaching them that year.
 *
 * Computer Science and Engineering teaches years 2-4 of the B.Tech; its first
 * year is taught by BASIC SCIENCE - ENGLISH, which is where those 175 students
 * are filed. Counting them under CSE because they are headed there put a first
 * year on a department that has none - its B.Tech strength read 175 when it
 * should read 0, and an "I Year" column appeared against a year it does not
 * teach. They are counted under Basic Science - English instead, which is
 * configured for year 1 and is where they are.
 *
 * With nothing configured either way, the old answer stands - a college that
 * has not set Years Taught is not second-guessed.
 */
export function resolveBranchName(
  row: Pick<StrengthRow, "department" | "secondaryDepartment" | "year" | "courseId" | "course">,
  departments: (CatalogDepartment & DepartmentYearRow)[],
  catalogIdOf: (row: Pick<StrengthRow, "courseId" | "course">) => string | undefined
): string {
  const secondary = cleanLabel(row.secondaryDepartment);
  const filed = cleanLabel(row.department);
  if (!secondary || !filed || secondary === filed) return secondary || filed;

  const year = Number(row.year);
  if (!Number.isInteger(year) || year < 1) return secondary;

  const branch = departments.find((d) => cleanLabel(d.name) === secondary);
  if (!branch) return secondary;
  const taught = managerEffectiveYears(branch as never, departments as never, catalogIdOf(row));
  if (taught.length === 0) return secondary;
  return taught.includes(year) ? secondary : filed;
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

  // The programme a student's course belongs to - Years Taught is configured
  // per catalog entry, so the branch check below has to be asked per course.
  const catalogCache = new Map<string, string | undefined>();
  const catalogIdOf = (row: Pick<StrengthRow, "courseId" | "course">): string | undefined => {
    const key = `${row.courseId ?? ""}${SEP}${row.course ?? ""}`;
    if (!catalogCache.has(key)) {
      const fromDoc = row.courseId ? courseById.get(row.courseId)?.catalogId : undefined;
      catalogCache.set(key, fromDoc ?? resolveCatalogId(catalog.courses as never, undefined, row.course));
    }
    return catalogCache.get(key);
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

    const branchName = resolveBranchName(row, catalog.departments as never, catalogIdOf);
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
      // The same rule a STUDENT is bucketed by (effectiveBranchName): the
      // branch it feeds when it has one, else its own department. Indexing a
      // section by its filing department instead put it under the feeder
      // while its students sat under the branch, so picking a branch emptied
      // the Section list: BSE-CSE-A/B/C are filed under BASIC SCIENCE -
      // ENGLISH but belong to COMPUTER SCIENCE AND ENGINEERING, and BSE-CS to
      // CSE [CYBER SECURITY].
      branch: normKey(cleanLabel(s.secondaryDepartments?.[0]) || cleanLabel(s.department)),
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
