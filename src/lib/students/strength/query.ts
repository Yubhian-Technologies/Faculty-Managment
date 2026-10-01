import { romanYear, statusRule, UNSET_LABELS } from "./config";
import type {
  BranchMeta,
  MatrixRow,
  ProgramMatrix,
  ProgramMeta,
  SectionRow,
  StrengthCell,
  StrengthFilters,
  StrengthMeta,
  StrengthReport,
} from "./types";

// Pure functions over the cube. The browser runs these on the aggregated cells
// the server returned (a few hundred buckets, never student records), which is
// why changing a filter updates every number instantly with no round trip -
// and the exact same functions build the printed / Excel report, so what is
// on screen and what is exported can never disagree.

export const DEFAULT_FILTERS: StrengthFilters = { status: "ENROLLED" };

export function statusMatches(status: string, filter: StrengthFilters["status"]): boolean {
  if (filter === "ALL") return true;
  if (filter === "ENROLLED") return statusRule(status).countsInStrength;
  return status === filter;
}

type Ignorable = "program" | "branch" | "year" | "section" | "batch" | "status";

/** Does `cell` satisfy every filter (except the ones named in `ignore`)? */
export function cellMatches(cell: StrengthCell, f: StrengthFilters, ignore: Ignorable[] = []): boolean {
  const skip = (k: Ignorable) => ignore.includes(k);
  if (!skip("program") && f.program !== undefined && cell.program !== f.program) return false;
  if (!skip("branch") && f.branch !== undefined && cell.branch !== f.branch) return false;
  if (!skip("year") && f.year !== undefined && cell.year !== f.year) return false;
  if (!skip("section") && f.section !== undefined && cell.section !== f.section) return false;
  if (!skip("batch") && f.batch !== undefined && cell.batch !== f.batch) return false;
  if (!skip("status") && !statusMatches(cell.status, f.status)) return false;
  return true;
}

/** THE count: how many students satisfy the filters. 0 for an empty combination. */
export function totalFor(cells: StrengthCell[], filters: StrengthFilters): number {
  let n = 0;
  for (const c of cells) if (cellMatches(c, filters)) n += c.count;
  return n;
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function branchInfo(meta: StrengthMeta, key: string): BranchMeta {
  return meta.branches.find((b) => b.key === key) ?? { key, label: UNSET_LABELS.branch, code: "", isFeeder: false, unknown: true };
}

function programInfo(meta: StrengthMeta, key: string): ProgramMeta {
  return meta.programs.find((p) => p.key === key) ?? { key, label: UNSET_LABELS.program, durationYears: 0, branchKeys: [] };
}

function sectionLabel(meta: StrengthMeta, key: string): string {
  return key === "" ? UNSET_LABELS.section : meta.sectionLabels[key] ?? key;
}

export interface ReportOptions {
  /** List configured departments with no students as 0 rows (the spreadsheet's empty branches). */
  includeEmptyDepartments?: boolean;
}

/**
 * The spreadsheet, generated: per program a Department x Year table with row
 * and column totals, plus the Department -> Year -> Section breakdown. Every
 * number is a sum of cells, so the grand total, each table and the section
 * rows always reconcile to `totalFor(cells, filters)`.
 */
export function buildReport(
  cells: StrengthCell[],
  meta: StrengthMeta,
  filters: StrengthFilters,
  opts: ReportOptions = {}
): StrengthReport {
  const filtered = cells.filter((c) => cellMatches(c, filters));
  const total = filtered.reduce((n, c) => n + c.count, 0);

  // ── Department x Year, one table per program ──
  const matrices: ProgramMatrix[] = [];
  for (const program of meta.programs) {
    if (filters.program !== undefined && program.key !== filters.program) continue;
    const pCells = filtered.filter((c) => c.program === program.key);

    const branchKeys = new Set(pCells.map((c) => c.branch));
    if (opts.includeEmptyDepartments) {
      for (const bk of program.branchKeys) {
        if (filters.branch !== undefined && bk !== filters.branch) continue;
        if (!branchInfo(meta, bk).isFeeder) branchKeys.add(bk);
      }
    }
    if (branchKeys.size === 0 && filters.program === undefined) continue;

    const observedYears = new Set(pCells.map((c) => c.year));
    let years: number[];
    if (filters.year !== undefined) {
      years = [filters.year];
    } else {
      const top = Math.max(program.durationYears, ...[...observedYears].filter((y) => y > 0), 0);
      years = Array.from({ length: top }, (_, i) => i + 1);
      if (observedYears.has(0)) years.push(0);
    }

    const rows: MatrixRow[] = [];
    for (const bk of branchKeys) {
      const info = branchInfo(meta, bk);
      const byYear: Record<number, number> = Object.fromEntries(years.map((y) => [y, 0]));
      let rowTotal = 0;
      for (const c of pCells) {
        if (c.branch !== bk) continue;
        byYear[c.year] = (byYear[c.year] ?? 0) + c.count;
        rowTotal += c.count;
      }
      rows.push({ branch: bk, label: info.label, code: info.code, byYear, total: rowTotal });
    }
    rows.sort((a, b) => collator.compare(a.code || a.label, b.code || b.label));

    const colTotals: Record<number, number> = Object.fromEntries(years.map((y) => [y, 0]));
    let programTotal = 0;
    for (const r of rows) {
      for (const y of years) colTotals[y] += r.byYear[y] ?? 0;
      programTotal += r.total;
    }
    matrices.push({ program: program.key, label: program.label, years, rows, byYear: colTotals, total: programTotal });
  }

  // ── Department -> Year -> Section ──
  const secMap = new Map<string, SectionRow>();
  const secKey = (p: string, b: string, y: number, s: string) => `${p}\u0001${b}\u0001${y}\u0001${s}`;
  for (const c of filtered) {
    const k = secKey(c.program, c.branch, c.year, c.section);
    const existing = secMap.get(k);
    if (existing) {
      existing.count += c.count;
      continue;
    }
    const b = branchInfo(meta, c.branch);
    secMap.set(k, {
      program: c.program,
      programLabel: programInfo(meta, c.program).label,
      branch: c.branch,
      branchLabel: b.label,
      branchCode: b.code,
      year: c.year,
      section: c.section,
      sectionLabel: sectionLabel(meta, c.section),
      count: c.count,
    });
  }

  // A configured section nobody is in yet (or whose students are all filtered
  // out by status) still shows, as 0. Skipped when a batch filter is on (Section
  // docs don't carry the student batch) and when the same section already has
  // students under the current filters in some branch (avoids a phantom
  // duplicate row when a Section doc's department differs from its students').
  if (filters.batch === undefined) {
    const withStudents = new Set(
      cells.filter((c) => cellMatches(c, filters, ["branch"])).map((c) => `${c.program}\u0001${c.year}\u0001${c.section}`)
    );
    for (const s of meta.sections) {
      if (filters.program !== undefined && s.program !== filters.program) continue;
      if (filters.branch !== undefined && s.branch !== filters.branch) continue;
      if (filters.year !== undefined && s.year !== filters.year) continue;
      if (filters.section !== undefined && s.section !== filters.section) continue;
      if (secMap.has(secKey(s.program, s.branch, s.year, s.section))) continue;
      if (withStudents.has(`${s.program}\u0001${s.year}\u0001${s.section}`)) continue;
      const b = branchInfo(meta, s.branch);
      secMap.set(secKey(s.program, s.branch, s.year, s.section), {
        program: s.program,
        programLabel: programInfo(meta, s.program).label,
        branch: s.branch,
        branchLabel: b.label,
        branchCode: b.code,
        year: s.year,
        section: s.section,
        sectionLabel: s.label,
        count: 0,
      });
    }
  }

  const sections = [...secMap.values()].sort(
    (a, b) =>
      collator.compare(a.programLabel, b.programLabel) ||
      collator.compare(a.branchCode || a.branchLabel, b.branchCode || b.branchLabel) ||
      a.year - b.year ||
      collator.compare(a.sectionLabel, b.sectionLabel)
  );

  return { total, matrices, sections };
}

// ─── Cascading filter options ───────────────────────────────────────────────

export interface FilterOptions {
  programs: { key: string; label: string }[];
  branches: { key: string; label: string; code: string }[];
  years: number[];
  sections: { key: string; label: string }[];
  batches: { key: string; label: string }[];
  statuses: { key: string; label: string }[];
}

/**
 * The choices each dropdown should offer. Hierarchical: Program -> Department
 * -> Year -> Section (and Batch), each list narrowed only by the selections
 * ABOVE it, so a stale lower selection can never erase a higher list, and
 * choosing a Department shows exactly the years and sections that department
 * has. Status never narrows anything. Configured-but-empty departments and
 * sections are included so an administrator can still pick - and get an
 * exact 0 for - a combination nobody is in yet.
 */
export function filterOptions(cells: StrengthCell[], meta: StrengthMeta, f: StrengthFilters): FilterOptions {
  // Cells narrowed by the selections above the list being built.
  const above = (list: "branch" | "year") => {
    const scope: StrengthFilters = { status: "ALL", program: f.program };
    if (list === "year") scope.branch = f.branch;
    return cells.filter((c) => cellMatches(c, scope));
  };
  const programsInScope = meta.programs.filter((p) => f.program === undefined || p.key === f.program);

  const programs = meta.programs.map((p) => ({ key: p.key, label: p.label }));

  const branchKeys = new Set(above("branch").map((c) => c.branch));
  for (const p of programsInScope) for (const bk of p.branchKeys) if (!branchInfo(meta, bk).isFeeder) branchKeys.add(bk);
  const branches = [...branchKeys]
    .map((key) => {
      const b = branchInfo(meta, key);
      return { key, label: b.label, code: b.code };
    })
    .sort((a, b) => collator.compare(a.code || a.label, b.code || b.label));

  const yearSet = new Set(above("year").map((c) => c.year));
  for (const p of programsInScope) {
    if (f.branch !== undefined && !p.branchKeys.includes(f.branch)) continue;
    for (let y = 1; y <= p.durationYears; y++) yearSet.add(y);
  }
  const years = [...yearSet].sort((a, b) => a - b);

  const withinYear = (c: StrengthCell) => cellMatches(c, { status: "ALL", program: f.program, branch: f.branch, year: f.year });
  const sectionMap = new Map<string, string>();
  for (const c of cells.filter(withinYear)) sectionMap.set(c.section, sectionLabel(meta, c.section));
  for (const s of meta.sections) {
    if (f.program !== undefined && s.program !== f.program) continue;
    if (f.branch !== undefined && s.branch !== f.branch) continue;
    if (f.year !== undefined && s.year !== f.year) continue;
    sectionMap.set(s.section, s.label);
  }
  const sections = [...sectionMap.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : collator.compare(a.label, b.label)));

  const batchKeys = new Set(cells.filter(withinYear).map((c) => c.batch));
  const batches = meta.batches.filter((b) => batchKeys.has(b.key));

  return {
    programs,
    branches,
    years,
    sections,
    batches,
    statuses: meta.statuses.map((s) => ({ key: s.key, label: s.label })),
  };
}

/** Drops any selected value that is no longer offered (e.g. the section after switching department). */
export function sanitizeFilters(f: StrengthFilters, o: FilterOptions): StrengthFilters {
  const out: StrengthFilters = { status: f.status };
  if (f.program !== undefined && o.programs.some((p) => p.key === f.program)) out.program = f.program;
  if (f.branch !== undefined && o.branches.some((b) => b.key === f.branch)) out.branch = f.branch;
  if (f.year !== undefined && o.years.includes(f.year)) out.year = f.year;
  if (f.section !== undefined && o.sections.some((s) => s.key === f.section)) out.section = f.section;
  if (f.batch !== undefined && o.batches.some((b) => b.key === f.batch)) out.batch = f.batch;
  return out;
}

// ─── Summary cards ──────────────────────────────────────────────────────────

export interface StrengthSummary {
  /** Students counted under the chosen status rule, whole college (program/department filters ignored). */
  total: number;
  byProgram: { key: string; label: string; count: number }[];
  detained: number;
  graduated: number;
  /** Enrolled students who aren't in a section yet. */
  unsectioned: number;
}

/**
 * Headline numbers. Deliberately NOT narrowed by the program/department/year/
 * section filters: they are the fixed frame of reference ("out of N in the
 * college") that the filtered answer sits inside.
 */
export function summarize(cells: StrengthCell[], meta: StrengthMeta, status: StrengthFilters["status"]): StrengthSummary {
  const base: StrengthFilters = { status };
  const byProgram = meta.programs
    .map((p) => ({ key: p.key, label: p.label, count: totalFor(cells, { ...base, program: p.key }) }))
    .filter((p) => p.count > 0);
  return {
    total: totalFor(cells, base),
    byProgram,
    detained: totalFor(cells, { status: "DETAINED" }),
    graduated: totalFor(cells, { status: "GRADUATED" }),
    unsectioned: totalFor(cells, { status: "ENROLLED", section: "" }),
  };
}

// ─── Plain-language description of the current selection ───────────────────

export function describeFilters(f: StrengthFilters, meta: StrengthMeta): string {
  const parts: string[] = [];
  if (f.program !== undefined) parts.push(programInfo(meta, f.program).label);
  if (f.branch !== undefined) {
    const b = branchInfo(meta, f.branch);
    parts.push(b.code || b.label);
  }
  if (f.year !== undefined) parts.push(f.year ? `${romanYear(f.year)} Year` : "Year not set");
  if (f.section !== undefined) parts.push(f.section === "" ? UNSET_LABELS.section : `Section ${sectionLabel(meta, f.section)}`);
  if (f.batch !== undefined) parts.push(`Batch ${meta.batches.find((b) => b.key === f.batch)?.label ?? f.batch}`);
  return parts.length ? parts.join(" · ") : "Whole college";
}

export function describeStatus(status: StrengthFilters["status"], meta: StrengthMeta): string {
  if (status === "ENROLLED") {
    const counted = meta.statuses.filter((s) => s.countsInStrength).map((s) => s.label);
    return `Enrolled students (${counted.join(" + ")})`;
  }
  if (status === "ALL") return "All students, every status";
  return `${meta.statuses.find((s) => s.key === status)?.label ?? status} students`;
}
