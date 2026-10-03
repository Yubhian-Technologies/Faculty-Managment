"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Printer, RefreshCw, Search, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { toCSV, downloadCSV } from "@/lib/utils/csv";
import { romanYear, UNSET_LABELS } from "@/lib/students/strength/config";
import {
  courseYearSummary,
  buildReport,
  describeFilters,
  describeScope,
  describeStatus,
  filterOptions,
  sanitizeFilters,
  summarize,
  totalCardLabel,
  totalFor,
  type CourseYearSummary,
  type ScopePart,
} from "@/lib/students/strength/query";
import { downloadStrengthXlsx, printStrengthReport, strengthCsvRows, type ExportContext } from "@/lib/students/strength/exporters";
import type { ProgramMatrix, SectionRow, StrengthFilters, StrengthPayload } from "@/lib/students/strength/types";

// The dashboard never counts anything itself beyond summing the aggregated
// cells the server built from the live student records
// (lib/students/strength). Every number - cards, tables, the answer, the
// print-out, the Excel file - is one of those sums, so changing a filter is
// instant and nothing here can drift from the student database.

const NONE = "__none__"; // Select values can't be "" - stands for the "not set" key.
const ALL = "__all__";
const toSel = (key: string | number | undefined) => (key === undefined ? ALL : key === "" ? NONE : String(key));
const fromSel = (v: string): string | undefined => (v === ALL ? undefined : v === NONE ? "" : v);
const fmt = (n: number) => n.toLocaleString("en-IN");

const REFRESH_AFTER_MS = 30_000;

type FetchResult = { ok: true; data: StrengthPayload } | { ok: false; error: string };

async function fetchStrength(): Promise<FetchResult> {
  try {
    const res = await fetch("/api/college/student-strength", { cache: "no-store" });
    const json = (await res.json()) as StrengthPayload & { error?: string };
    if (!res.ok) return { ok: false, error: json.error ?? "Failed to load student strength" };
    return { ok: true, data: json };
  } catch {
    return { ok: false, error: "Network error - please try again" };
  }
}

function nameOf(b: { code: string; label: string }) {
  return b.code || b.label;
}

export function StudentStrengthDashboard() {
  const [data, setData] = useState<StrengthPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);

  const [filters, setFilters] = useState<StrengthFilters>({ status: "ENROLLED" });
  const [showEmpty, setShowEmpty] = useState(false);
  const [search, setSearch] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  // Applies a fetch result. Only ever called from promise callbacks / event
  // handlers, never synchronously from an effect body.
  const apply = useCallback((res: FetchResult, background: boolean) => {
    if (res.ok) {
      setData(res.data);
      setError(null);
      setLoadedAt(Date.now());
    } else if (background) {
      toast({ variant: "destructive", title: res.error });
    } else {
      setError(res.error);
    }
    setIsLoading(false);
    setIsRefreshing(false);
  }, []);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    apply(await fetchStrength(), true);
  }, [apply]);

  useEffect(() => {
    let cancelled = false;
    void fetchStrength().then((res) => {
      if (!cancelled) apply(res, false);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  // Counts are live, so pick up student changes made elsewhere as soon as the
  // administrator comes back to this tab.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt > REFRESH_AFTER_MS) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh, loadedAt]);

  const cells = data?.cells;
  const meta = data?.meta;

  const options = useMemo(() => (cells && meta ? filterOptions(cells, meta, filters) : null), [cells, meta, filters]);
  // After a refresh a previously chosen section/department may no longer exist.
  const f = useMemo(() => (options ? sanitizeFilters(filters, options) : filters), [filters, options]);

  const summary = useMemo(() => (cells && meta ? summarize(cells, meta, f.status) : null), [cells, meta, f.status]);
  const report = useMemo(() => (cells && meta ? buildReport(cells, meta, f, { includeEmptyDepartments: showEmpty }) : null), [cells, meta, f, showEmpty]);
  const answer = useMemo(() => (cells ? totalFor(cells, f) : 0), [cells, f]);
  // Each course with its years, for the answer card - read from the same report
  // logic (configured-but-empty courses included, as an exact 0).
  const courseYears = useMemo(
    () => (cells && meta ? courseYearSummary(buildReport(cells, meta, f, { includeEmptyDepartments: true }), meta) : []),
    [cells, meta, f]
  );

  function change(patch: Partial<StrengthFilters>) {
    if (!cells || !meta) return;
    const next = { ...f, ...patch };
    setFilters(sanitizeFilters(next, filterOptions(cells, meta, next)));
  }

  const ctx = useMemo<ExportContext | null>(() => {
    if (!data || !meta) return null;
    return {
      collegeName: data.collegeName || "College",
      session: data.session || "",
      selection: describeFilters(f, meta).replace(/^Whole college$/, data.scope === "department" ? "All students under your department" : "Whole college") + (data.scope === "department" ? " · Your department only" : ""),
      statusRule: describeStatus(f.status, meta),
      generatedAt: new Date(data.generatedAt),
    };
  }, [data, meta, f]);

  async function onExcel() {
    if (!report || !ctx) return;
    setIsExporting(true);
    try {
      await downloadStrengthXlsx(report, ctx, `student-strength-${ctx.session || "current"}.xlsx`);
    } catch {
      toast({ variant: "destructive", title: "Excel export failed" });
    } finally {
      setIsExporting(false);
    }
  }
  function onCsv() {
    if (!report || !ctx) return;
    downloadCSV(toCSV(strengthCsvRows(report)), `student-strength-sections-${ctx.session || "current"}.csv`);
  }
  function onPrint() {
    if (!report || !ctx) return;
    if (!printStrengthReport(report, ctx)) toast({ variant: "destructive", title: "Allow pop-ups to print the report" });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Calculating strength from student records…
      </div>
    );
  }
  if (error && !data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => { setIsLoading(true); void fetchStrength().then((res) => apply(res, false)); }}>Try again</Button>
        </CardContent>
      </Card>
    );
  }
  if (!data || !meta || !cells || !options || !summary || !report || !ctx) return null;

  const hasStudents = data.health.totalRecords > 0;
  const scoped = data.scope === "department";
  const filtered = f.program !== undefined || f.branch !== undefined || f.year !== undefined || f.section !== undefined || f.batch !== undefined;
  const observedStatuses = new Set(cells.map((c) => c.status));
  const statusOptions = meta.statuses.filter((s) => s.countsInStrength || observedStatuses.has(s.key));

  const scopeParts = describeScope(f, meta);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              Academic Year {data.session || "-"} · current
            </span>
            {data.scope === "department" && (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Only students under your department</span>
            )}
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            {data.integrity && data.integrity.databaseCount === data.integrity.scannedRecords ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Live from {fmt(data.integrity.scannedRecords)} student records
              </span>
            ) : (
              <span>Live from student records</span>
            )}
            <span>· updated {new Date(data.generatedAt).toLocaleTimeString("en-IN")}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={isRefreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => void onExcel()} disabled={isExporting || !hasStudents}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />Excel
          </Button>
          <Button variant="outline" size="sm" onClick={onCsv} disabled={!hasStudents}>
            <Download className="mr-2 h-4 w-4" />CSV
          </Button>
          <Button variant="outline" size="sm" onClick={onPrint} disabled={!hasStudents}>
            <Printer className="mr-2 h-4 w-4" />Print
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <FilterSelect label="Course" value={toSel(f.program)} onChange={(v) => change({ program: fromSel(v) })} allLabel="All courses">
              {options.programs.map((p) => <SelectItem key={p.key || NONE} value={toSel(p.key)}>{p.label}</SelectItem>)}
            </FilterSelect>
            <FilterSelect label="Department" value={toSel(f.branch)} onChange={(v) => change({ branch: fromSel(v) })} allLabel="All departments">
              {options.branches.map((b) => (
                <SelectItem key={b.key || NONE} value={toSel(b.key)}>
                  {b.code && b.code !== b.label ? `${b.code} - ${b.label}` : b.label}
                </SelectItem>
              ))}
            </FilterSelect>
            <FilterSelect label="Year" value={toSel(f.year)} onChange={(v) => change({ year: v === ALL ? undefined : Number(v) })} allLabel="All years">
              {options.years.map((y) => <SelectItem key={y} value={String(y)}>{y ? `${romanYear(y)} Year` : "Year not set"}</SelectItem>)}
            </FilterSelect>
            <FilterSelect label="Section" value={toSel(f.section)} onChange={(v) => change({ section: fromSel(v) })} allLabel="All sections">
              {options.sections.map((s) => <SelectItem key={s.key || NONE} value={toSel(s.key)}>{s.key === "" ? UNSET_LABELS.section : s.label}</SelectItem>)}
            </FilterSelect>
            <FilterSelect label="Admission batch" value={toSel(f.batch)} onChange={(v) => change({ batch: fromSel(v) })} allLabel="All batches">
              {options.batches.map((b) => <SelectItem key={b.key} value={b.key}>{b.label}</SelectItem>)}
            </FilterSelect>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Student status</label>
              <Select value={f.status} onValueChange={(v) => change({ status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ENROLLED">Enrolled students</SelectItem>
                  <SelectItem value="ALL">All students (every status)</SelectItem>
                  {statusOptions.map((s) => <SelectItem key={s.key} value={s.key}>{s.label} only</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Counts are always the live, current picture - past sessions aren&apos;t stored as snapshots, so there is nothing to fall out of date.
            </span>
            {(filtered || f.status !== "ENROLLED") && (
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setFilters({ status: "ENROLLED" })}>Reset filters</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {!hasStudents ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Users className="h-7 w-7 text-muted-foreground" />
            <p className="text-sm font-medium">No students yet</p>
            <p className="text-xs text-muted-foreground">Strength appears here automatically as soon as students are added or imported.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* The answer */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{filtered ? "Exact count for your selection" : scoped ? "Total strength - your department" : "Total college strength"}</p>
                  <p className="mt-1 text-5xl font-bold tabular-nums text-primary" data-testid="strength-answer">{fmt(answer)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{describeStatus(f.status, meta)}</p>
                </div>
                <ScopeChips parts={scopeParts} scoped={scoped} />
              </div>
              {courseYears.length > 0 && (
                <div className="border-t border-primary/20 pt-3">
                  <CourseYearList courses={courseYears} onPick={(patch) => change(patch)} />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label={totalCardLabel(f.status, meta, scoped)} value={summary.total} accent />
            {summary.byProgram.map((p) => (
              <StatCard key={p.key || NONE} label={`Total ${p.label}`} value={p.count} onClick={() => change({ program: p.key })} active={f.program === p.key} />
            ))}
          </div>

          {/* Department x Year */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Strength report - Department × Year</h2>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={showEmpty} onCheckedChange={(v) => setShowEmpty(v === true)} />
                Show departments with no students
              </label>
            </div>
            {scoped && (
              <p className="text-xs text-muted-foreground">
                Only the students you are responsible for are counted. A branch you teach in one year (for example a shared first year) shows just those students - its other years belong to that branch&apos;s own HOD.
              </p>
            )}
            {report.matrices.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">0 students match this selection.</CardContent></Card>
            ) : (
              report.matrices.map((m) => (
                <MatrixTable
                  key={m.program || NONE}
                  matrix={m}
                  activeBranch={f.branch}
                  activeYear={f.year}
                  onPickBranch={(branch) => change({ program: m.program, branch, year: undefined, section: undefined })}
                  onPickCell={(branch, year) => change({ program: m.program, branch, year, section: undefined })}
                />
              ))
            )}
            <div className="flex items-center justify-between rounded-lg border-2 border-primary/40 bg-primary/5 px-4 py-2.5">
              <span className="text-sm font-bold tracking-wide">{filtered ? "TOTAL FOR SELECTION" : scoped ? "TOTAL - YOUR DEPARTMENT" : "OVERALL STRENGTH"}</span>
              <span className="text-xl font-bold tabular-nums text-primary">{fmt(report.total)}</span>
            </div>
          </div>

          {/* Section-wise */}
          <SectionTable rows={report.sections} total={report.total} search={search} onSearch={setSearch} />

          {/* Data checks */}
          <DataChecks health={data.health} />
        </>
      )}
    </div>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function FilterSelect({
  label, value, onChange, allLabel, children,
}: { label: string; value: string; onChange: (v: string) => void; allLabel: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {children}
        </SelectContent>
      </Select>
    </div>
  );
}

/** What the number covers, one dimension at a time ("Course: All courses", "Department: IT", ...). */
function ScopeChips({ parts, scoped }: { parts: ScopePart[]; scoped: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5 md:max-w-xl md:justify-end" data-testid="strength-scope">
      {parts.map((p) => (
        <span
          key={p.label}
          className={`rounded-full border px-2.5 py-1 text-xs ${p.all ? "bg-background text-muted-foreground" : "border-primary/40 bg-primary/10 font-medium text-primary"}`}
        >
          <span className="opacity-70">{p.label}:</span> {p.value}
        </span>
      ))}
      {scoped && <span className="rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground">Your department only</span>}
    </div>
  );
}

/**
 * Each course, one after another, with its total and its year-wise counts -
 * nothing finer (no departments, no sections; those live in the tables below).
 * Course names and year chips filter to themselves when clicked.
 */
function CourseYearList({ courses, onPick }: { courses: CourseYearSummary[]; onPick: (patch: Partial<StrengthFilters>) => void }) {
  return (
    <ul className="divide-y divide-primary/15" data-testid="strength-courses">
      {courses.map((c) => (
        <li key={c.key || NONE} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2" data-testid="strength-course">
          <button
            type="button"
            title={`Filter to ${c.label}`}
            onClick={() => onPick({ program: c.key })}
            className={`flex min-w-[15rem] items-baseline gap-2 text-left hover:underline ${c.count === 0 ? "opacity-50" : ""}`}
          >
            <span className="text-sm font-bold">{c.label}</span>
            <span className="text-lg font-bold tabular-nums text-primary" data-testid="strength-course-count">{fmt(c.count)}</span>
          </button>
          <div className="flex flex-wrap gap-1.5">
            {c.years.map((y) => (
              <button
                key={y.year}
                type="button"
                title={`Filter to ${c.label} · ${y.label}`}
                onClick={() => onPick({ program: c.key, year: y.year })}
                className={`flex items-baseline gap-1.5 rounded-lg border bg-background px-2.5 py-1 transition-colors hover:border-primary hover:bg-primary/5 ${y.count === 0 ? "opacity-50" : ""}`}
              >
                <span className="text-xs text-muted-foreground">{y.label}</span>
                <span className="text-sm font-semibold tabular-nums">{fmt(y.count)}</span>
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

function StatCard({
  label, value, accent, tone, onClick, active,
}: { label: string; value: number; accent?: boolean; tone?: "warn"; onClick?: () => void; active?: boolean }) {
  const body = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ? "text-primary" : tone === "warn" ? "text-amber-600" : ""}`}>{fmt(value)}</p>
    </>
  );
  const cls = `rounded-lg border bg-card p-3 text-left ${active ? "ring-2 ring-primary" : ""} ${accent ? "border-primary/40" : ""}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} transition-colors hover:bg-muted/50`}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function MatrixTable({
  matrix, activeBranch, activeYear, onPickBranch, onPickCell,
}: {
  matrix: ProgramMatrix;
  activeBranch: string | undefined;
  activeYear: number | undefined;
  onPickBranch: (branch: string) => void;
  onPickCell: (branch: string, year: number) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b bg-muted/50 px-4 py-2 text-center text-sm font-bold tracking-wide">{matrix.label.toUpperCase()}</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <th className="w-12 border-b border-r px-3 py-2 text-center font-semibold">SL</th>
              <th className="border-b border-r px-3 py-2 text-left font-semibold">Branch</th>
              {matrix.years.map((y) => <th key={y} className="w-20 border-b border-r px-3 py-2 text-center font-semibold">{romanYear(y)}</th>)}
              <th className="w-24 border-b px-3 py-2 text-center font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((r, i) => (
              <tr key={r.branch || NONE} className={`hover:bg-muted/30 ${activeBranch === r.branch ? "bg-primary/5" : ""}`}>
                <td className="border-b border-r px-3 py-1.5 text-center text-muted-foreground">{i + 1}</td>
                <td className="border-b border-r px-3 py-1.5">
                  <button type="button" className="text-left hover:underline" onClick={() => onPickBranch(r.branch)} title="Filter to this department">
                    <span className="font-semibold">{nameOf(r)}</span>
                    {r.code && r.code !== r.label && <span className="ml-2 text-xs text-muted-foreground">{r.label}</span>}
                  </button>
                </td>
                {matrix.years.map((y) => (
                  <td key={y} className={`border-b border-r px-3 py-1.5 text-center tabular-nums ${activeBranch === r.branch && activeYear === y ? "bg-primary/10 font-semibold" : ""}`}>
                    <button
                      type="button"
                      onClick={() => onPickCell(r.branch, y)}
                      className={`w-full hover:underline ${(r.byYear[y] ?? 0) === 0 ? "text-muted-foreground/60" : ""}`}
                      title="Filter to this department and year"
                    >
                      {fmt(r.byYear[y] ?? 0)}
                    </button>
                  </td>
                ))}
                <td className="border-b px-3 py-1.5 text-center font-semibold tabular-nums">{fmt(r.total)}</td>
              </tr>
            ))}
            {matrix.rows.length === 0 && (
              <tr><td colSpan={matrix.years.length + 3} className="px-3 py-5 text-center text-muted-foreground">0 students</td></tr>
            )}
            <tr className="bg-muted/40 font-bold">
              <td colSpan={2} className="border-r px-3 py-2 text-center">TOTAL</td>
              {matrix.years.map((y) => <td key={y} className="border-r px-3 py-2 text-center tabular-nums">{fmt(matrix.byYear[y] ?? 0)}</td>)}
              <td className="px-3 py-2 text-center tabular-nums">{fmt(matrix.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionTable({
  rows, total, search, onSearch,
}: { rows: SectionRow[]; total: number; search: string; onSearch: (v: string) => void }) {
  const q = search.trim().toLowerCase();
  const visible = q
    ? rows.filter((r) =>
        [r.programLabel, r.branchLabel, r.branchCode, r.sectionLabel, r.year ? `${romanYear(r.year)} year` : ""].some((t) => t.toLowerCase().includes(q))
      )
    : rows;

  // group: program -> branch -> year
  const groups: { key: string; program: string; branch: string; year: number; rows: SectionRow[]; sum: number }[] = [];
  for (const r of visible) {
    const key = `${r.program}|${r.branch}|${r.year}`;
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, program: r.programLabel, branch: nameOf({ code: r.branchCode, label: r.branchLabel }), year: r.year, rows: [], sum: 0 };
      groups.push(g);
    }
    g.rows.push(r);
    g.sum += r.count;
  }
  const visibleTotal = visible.reduce((n, r) => n + r.count, 0);
  const multiProgram = new Set(rows.map((r) => r.program)).size > 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Section-wise breakdown - Department → Year → Section</h2>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search department, year, section" className="h-9 pl-9" />
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <th className="border-b border-r px-3 py-2 text-left font-semibold">Department</th>
                <th className="w-24 border-b border-r px-3 py-2 text-center font-semibold">Year</th>
                <th className="border-b border-r px-3 py-2 text-left font-semibold">Section</th>
                <th className="w-28 border-b px-3 py-2 text-center font-semibold">Students</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows key={g.key} group={g} showProgram={multiProgram} />
              ))}
              {groups.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">{q ? "No sections match your search." : "0 students match this selection."}</td></tr>
              )}
              <tr className="bg-muted/40 font-bold">
                <td colSpan={3} className="border-r px-3 py-2 text-right">{q ? "TOTAL (shown)" : "TOTAL"}</td>
                <td className="px-3 py-2 text-center tabular-nums">{fmt(q ? visibleTotal : total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function GroupRows({ group, showProgram }: { group: { program: string; branch: string; year: number; rows: SectionRow[]; sum: number }; showProgram: boolean }) {
  return (
    <>
      <tr className="bg-muted/20">
        <td className="border-b border-r px-3 py-1.5 font-semibold">
          {group.branch}
          {showProgram && <span className="ml-2 text-xs font-normal text-muted-foreground">{group.program}</span>}
        </td>
        <td className="border-b border-r px-3 py-1.5 text-center font-semibold">{group.year ? romanYear(group.year) : "-"}</td>
        <td className="border-b border-r px-3 py-1.5 text-xs text-muted-foreground">{group.rows.length} section{group.rows.length === 1 ? "" : "s"}</td>
        <td className="border-b px-3 py-1.5 text-center font-semibold tabular-nums">{fmt(group.sum)}</td>
      </tr>
      {group.rows.map((r) => (
        <tr key={`${r.section}`} className="hover:bg-muted/30">
          <td className="border-b border-r px-3 py-1.5" />
          <td className="border-b border-r px-3 py-1.5" />
          <td className={`border-b border-r px-3 py-1.5 ${r.section === "" ? "italic text-amber-700" : ""}`}>{r.sectionLabel}</td>
          <td className={`border-b px-3 py-1.5 text-center tabular-nums ${r.count === 0 ? "text-muted-foreground/60" : ""}`}>{fmt(r.count)}</td>
        </tr>
      ))}
    </>
  );
}

function DataChecks({ health }: { health: StrengthPayload["health"] }) {
  const issues: { label: string; detail?: string }[] = [];
  if (health.duplicateRolls.length > 0) {
    issues.push({
      label: `${health.duplicateRolls.length} roll number${health.duplicateRolls.length === 1 ? " is" : "s are"} shared by more than one student`,
      detail: health.duplicateRolls
        .slice(0, 8)
        .map((d) => `${d.roll} (${d.holders.map((h) => h.name || "unnamed").join(", ")})`)
        .join(" · "),
    });
  }
  if (health.enrolledWithoutSection > 0) issues.push({ label: `${fmt(health.enrolledWithoutSection)} enrolled student(s) not yet placed in a section` });
  if (health.enrolledWithoutProgram > 0) issues.push({ label: `${fmt(health.enrolledWithoutProgram)} enrolled student(s) have no course recorded` });
  if (health.enrolledWithoutYear > 0) issues.push({ label: `${fmt(health.enrolledWithoutYear)} enrolled student(s) have no year of study` });
  if (health.enrolledUnknownBranch > 0) issues.push({ label: `${fmt(health.enrolledUnknownBranch)} enrolled student(s) sit under a department that isn't in the Departments list` });
  if (health.unrecognizedStatus > 0) issues.push({ label: `${fmt(health.unrecognizedStatus)} student(s) have an unrecognized status and are excluded from strength` });

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <h2 className="text-sm font-semibold">Data checks</h2>
        {issues.length === 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Every student is assigned to a course, department, year and section, and every roll number is unique.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {issues.map((i) => (
              <li key={i.label} className="flex items-start gap-2 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  {i.label}
                  {i.detail && <span className="block text-xs text-muted-foreground">{i.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
