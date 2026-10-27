"use client";

// Faculty Profile Completion Rate report, shared across the three role
// dashboards that need it (same "one view component, role parameterized"
// pattern as ResultsAnalysisView / FacultyAttendanceCompletionView):
//   - HOD: own department tree only, auto-loaded (no filter needed - mirrors
//     hod/faculty/page.tsx, which has no department dropdown either).
//   - PRINCIPAL / VICE_PRINCIPAL: department dropdown (+ "All Departments") +
//     Load button (mirrors principal/faculty/page.tsx exactly).
//   - SUPER_ADMIN: college picker + department dropdown + Load button (college
//     picker mirrors super-admin/audit-logs/page.tsx; department dropdown
//     reuses the same hierarchy-building logic as the Principal variant).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDown } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAdminColleges } from "@/hooks/useAdminColleges";
import { toast } from "@/hooks/useToast";
import { exportFacultyProfileCompletionExcel } from "@/lib/faculty/profileCompletionExport";
import type { CompletionModuleKey } from "@/lib/faculty/profileCompletion";
import {
  NO_COMPLETION_FILTERS, completionDesignationOptions, filterCompletionRows, hasActiveCompletionFilters, isPercentRangeBackwards,
  type CompletionFilters,
} from "@/lib/faculty/profileCompletionFilters";
import type { College, Department } from "@/types";

const ALL_DEPTS = "__ALL__";

interface SectionDef { key: CompletionModuleKey; label: string }
interface SectionRow { key: CompletionModuleKey; label: string; filledCount: number; totalCount: number; percent: number; isComplete: boolean }
// Intersected with Record<string, unknown> so DataTable's generic constraint
// accepts it directly, same convention as FacultyListRow in facultyListCells.tsx.
type FacultyCompletionRow = Record<string, unknown> & {
  id: string;
  employeeId?: string;
  name: string;
  department?: string;
  designation?: string;
  status?: string;
  overallPercent: number;
  sections: SectionRow[];
};

function percentBadgeVariant(percent: number): "default" | "secondary" | "outline" {
  if (percent >= 100) return "default";
  if (percent >= 50) return "secondary";
  return "outline";
}

function PercentBar({ percent }: { percent: number }) {
  return (
    <div className="flex items-center gap-2 min-w-35">
      <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
        <div
          className={percent >= 100 ? "h-full bg-primary" : "h-full bg-primary/60"}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <Badge variant={percentBadgeVariant(percent)} className="shrink-0">{percent}%</Badge>
    </div>
  );
}

// Builds the hierarchical (parent, then indented children) dropdown options
// used by every department filter in this app - same logic as
// principal/faculty/page.tsx's departmentOptions.
function buildDepartmentOptions(departments: Department[]): { value: string; label: string }[] {
  const topLevel = departments.filter((d) => !d.parentDepartmentId);
  const options: { value: string; label: string }[] = [];
  for (const parent of topLevel) {
    options.push({ value: parent.name, label: `${parent.name} (${parent.code})` });
    for (const child of departments.filter((d) => d.parentDepartmentId === parent.id)) {
      options.push({ value: child.name, label: `↳ ${child.name} (${child.code})` });
    }
  }
  const orphans = departments.filter((d) => d.parentDepartmentId && !departments.some((p) => p.id === d.parentDepartmentId));
  for (const orphan of orphans) options.push({ value: orphan.name, label: `${orphan.name} (${orphan.code})` });
  return options;
}

function DepartmentBreakdownDialog({ row, onClose }: { row: FacultyCompletionRow | null; onClose: () => void }) {
  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{row?.name} - Profile Completion</DialogTitle>
        </DialogHeader>
        {row && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Overall Completion</p>
              <PercentBar percent={row.overallPercent} />
            </div>
            <div className="space-y-3 pt-2 border-t">
              {row.sections.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{s.label}</p>
                    {!s.isComplete && (
                      <p className="text-xs text-muted-foreground">
                        {s.totalCount - s.filledCount} of {s.totalCount} field{s.totalCount === 1 ? "" : "s"} left to fill
                      </p>
                    )}
                  </div>
                  {s.isComplete ? (
                    <Badge>Filled</Badge>
                  ) : (
                    <PercentBar percent={s.percent} />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function FacultyProfileCompletionView({ role }: { role: "HOD" | "PRINCIPAL" | "SUPER_ADMIN" }) {
  const needsFilters = role !== "HOD";
  const { data: colleges = [] } = useAdminColleges({ enabled: role === "SUPER_ADMIN" });

  const [selectedCollegeId, setSelectedCollegeId] = useState("");
  const [selectedDept, setSelectedDept] = useState(ALL_DEPTS);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [rows, setRows] = useState<FacultyCompletionRow[]>([]);
  const [sectionDefs, setSectionDefs] = useState<SectionDef[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [detailRow, setDetailRow] = useState<FacultyCompletionRow | null>(null);
  // Designation + Completion % filters: applied in the browser to the rows already loaded (nothing is re-fetched).
  const [filters, setFilters] = useState<CompletionFilters>(NO_COMPLETION_FILTERS);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Super Admin only - default to the first college, and fetch its departments
  // for the dropdown (their own /api/college/departments has no collegeId to
  // resolve a Super Admin session against).
  useEffect(() => {
    if (role === "SUPER_ADMIN" && !selectedCollegeId && colleges.length > 0) {
      setSelectedCollegeId(colleges[0].id);
    }
  }, [role, colleges, selectedCollegeId]);

  useEffect(() => {
    if (role === "HOD") return;
    const deptUrl = role === "SUPER_ADMIN"
      ? (selectedCollegeId ? `/api/admin/departments?collegeId=${selectedCollegeId}` : null)
      : "/api/college/departments";
    if (!deptUrl) { setDepartments([]); return; }
    fetch(deptUrl)
      .then((r) => r.json() as Promise<{ departments?: Department[] }>)
      .then((d) => setDepartments(d.departments ?? []))
      .catch(() => setDepartments([]));
    // Switching college invalidates whatever was loaded under the old one.
    setRows([]);
    setHasLoaded(false);
    setSelectedDept(ALL_DEPTS);
  }, [role, selectedCollegeId]);

  const departmentOptions = useMemo(() => buildDepartmentOptions(departments), [departments]);

  // Only designations present in what was loaded are offered; a pick that a new Load no longer contains counts as "all".
  const designationOptions = useMemo(() => completionDesignationOptions(rows), [rows]);
  const activeFilters = useMemo<CompletionFilters>(
    () => ({ ...filters, designation: designationOptions.some((o) => o.value === filters.designation) ? filters.designation : "" }),
    [filters, designationOptions],
  );
  const filteredRows = useMemo(() => filterCompletionRows(rows, activeFilters), [rows, activeFilters]);
  const filtersActive = hasActiveCompletionFilters(activeFilters);

  const handleLoad = useCallback(async (dept = selectedDept) => {
    if (role === "SUPER_ADMIN" && !selectedCollegeId) {
      toast({ variant: "destructive", title: "Select a college first" });
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (dept && dept !== ALL_DEPTS) params.set("department", dept);
      if (role === "SUPER_ADMIN") params.set("collegeId", selectedCollegeId);
      const res = await fetch(`/api/college/faculty/profile-completion?${params.toString()}`, { signal: ctrl.signal });
      const data = await res.json() as { faculty?: FacultyCompletionRow[]; sections?: SectionDef[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setRows(data.faculty ?? []);
      setSectionDefs(data.sections ?? []);
      setHasLoaded(true);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      toast({ variant: "destructive", title: "Failed to load profile completion", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsLoading(false);
    }
  }, [role, selectedCollegeId, selectedDept]);

  // HOD has no filter UI - behaves exactly like hod/faculty/page.tsx (auto-load).
  useEffect(() => {
    if (role === "HOD") void handleLoad(ALL_DEPTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  async function handleExport() {
    // What the filters leave (everything, when none is set).
    await exportFacultyProfileCompletionExcel(filteredRows, sectionDefs, new Date().toISOString().slice(0, 10));
  }

  const columns: Column<FacultyCompletionRow>[] = [
    { key: "employeeId", header: "Employee ID", render: (r) => r.employeeId || "-" },
    { key: "name", header: "Name" },
    { key: "department", header: "Department", render: (r) => r.department || "-" },
    { key: "designation", header: "Designation", render: (r) => r.designation || "-" },
    {
      key: "overallPercent", header: "Profile Completion",
      render: (r) => <PercentBar percent={r.overallPercent} />,
      csvValue: (r) => `${r.overallPercent}%`,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Profile Completion Statistics"
        description={role === "HOD"
          ? "Monitor faculty profile completion across your department. Select a faculty member to view detailed completion statistics."
          : "How much of each faculty member's own profile is filled in, section by section. Select a faculty record to view a detailed breakdown of profile completion."}
        actions={
          hasLoaded && rows.length > 0 ? (
            <Button variant="outline" onClick={handleExport}>
              <FileDown className="h-4 w-4 mr-2" />Export to Excel
            </Button>
          ) : undefined
        }
      />

      {needsFilters && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-4">
            {role === "SUPER_ADMIN" && (
              <div className="space-y-1.5 min-w-55">
                <Label>College</Label>
                <Select value={selectedCollegeId} onValueChange={setSelectedCollegeId}>
                  <SelectTrigger><SelectValue placeholder="Select a college" /></SelectTrigger>
                  <SelectContent>
                    {colleges.map((c: College) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5 min-w-55">
              <Label>Department</Label>
              <Select value={selectedDept} onValueChange={setSelectedDept}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_DEPTS}>All Departments</SelectItem>
                  {departmentOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => handleLoad(selectedDept)} loading={isLoading} disabled={role === "SUPER_ADMIN" && !selectedCollegeId}>
              Load
            </Button>
            {!hasLoaded && <p className="text-sm text-muted-foreground ml-auto">Pick a department (or leave All) and click Load.</p>}
          </CardContent>
        </Card>
      )}

      {hasLoaded && rows.length > 0 && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-4">
            <div className="space-y-1.5 min-w-55">
              <Label>Designation</Label>
              <Select
                value={activeFilters.designation || "__ALL__"}
                onValueChange={(v) => setFilters((f) => ({ ...f, designation: v === "__ALL__" ? "" : v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ALL__">All Designations</SelectItem>
                  {designationOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Profile Completion (%)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number" inputMode="numeric" min={0} max={100} className="w-24" placeholder="Min" aria-label="Minimum completion percent"
                  value={filters.minPercent} onChange={(e) => setFilters((f) => ({ ...f, minPercent: e.target.value }))}
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="number" inputMode="numeric" min={0} max={100} className="w-24" placeholder="Max" aria-label="Maximum completion percent"
                  value={filters.maxPercent} onChange={(e) => setFilters((f) => ({ ...f, maxPercent: e.target.value }))}
                />
              </div>
            </div>
            {filtersActive && (
              <Button variant="ghost" onClick={() => setFilters(NO_COMPLETION_FILTERS)}>Clear filters</Button>
            )}
            <p className="text-sm text-muted-foreground ml-auto">
              {isPercentRangeBackwards(activeFilters)
                ? "Min is higher than Max - nothing can match."
                : filtersActive ? `Showing ${filteredRows.length} of ${rows.length}` : `${rows.length} faculty`}
            </p>
          </CardContent>
        </Card>
      )}

      <DataTable
        data={filteredRows}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id}
        onRowClick={(r) => setDetailRow(r)}
        searchKeys={["name", "employeeId", "department"] as (keyof FacultyCompletionRow)[]}
        searchPlaceholder="Search by name, employee ID or department..."
        emptyTitle={hasLoaded ? "No faculty found" : needsFilters ? "Not loaded yet" : "No faculty found"}
        emptyDescription={!hasLoaded && needsFilters ? "Pick a department and click Load to view profile completion." : filtersActive ? "No one matches the Designation / Profile Completion filters - change or clear them." : undefined}
      />

      <DepartmentBreakdownDialog row={detailRow} onClose={() => setDetailRow(null)} />
    </div>
  );
}
