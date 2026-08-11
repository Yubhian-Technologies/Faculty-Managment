"use client";

import { useEffect, useMemo, useState } from "react";
import { Shuffle, Pencil, Layers } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import { structureFromDepartments, type DepartmentWithId } from "@/lib/college/academicStructure";
import { yearOrdinalLabel } from "@/lib/college/academicYears";
import type { StudentListItem, Section, Department } from "@/types";

type StudentRow = Record<string, unknown> & StudentListItem;
type SectionRow = Section & { id: string; accessLevel?: "primary" | "secondary" };

interface CohortBranchResult {
  branch: string;
  managedBy?: string;
  distributed: number;
  perSection: { section: string; count: number }[];
  skippedReason?: string;
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  REGULAR: "default",
  DETAINED: "outline",
  GRADUATED: "secondary",
};

export default function HodStudentsPage() {
  const myDepartment = useAuthStore((s) => s.user?.department);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deptFilter, setDeptFilter] = useState("all");

  const [cohortOpen, setCohortOpen] = useState(false);
  const [cohortResult, setCohortResult] = useState<CohortBranchResult[] | null>(null);
  const [isDistributingCohort, setIsDistributingCohort] = useState(false);

  const [distributeOpen, setDistributeOpen] = useState(false);
  const [distDept, setDistDept] = useState("");
  const [distYear, setDistYear] = useState("");
  const [distSectionIds, setDistSectionIds] = useState<string[]>([]);
  const [isDistributing, setIsDistributing] = useState(false);

  const [editTarget, setEditTarget] = useState<StudentRow | null>(null);
  const [editRoll, setEditRoll] = useState("");
  const [editStatus, setEditStatus] = useState("REGULAR");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const [studentsRes, sectionsRes, deptsRes] = await Promise.all([
        fetch("/api/college/students").then((r) => r.json() as Promise<{ students: StudentRow[] }>),
        fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections: SectionRow[] }>),
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
      ]);
      setStudents(studentsRes.students ?? []);
      setSections(sectionsRes.sections ?? []);
      setDepartments(deptsRes.departments ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load students" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // Wrapped so the loader's setState calls aren't synchronously reachable
    // from the effect body (react-hooks/set-state-in-effect).
    void (async () => { await load(); })();
  }, []);

  // Only departments the sub-HOD fully manages (primary sections) can be
  // distributed / sectioned - a genuinely cross-listed (secondary) section
  // belongs to someone else.
  const managedSections = useMemo(
    () => sections.filter((s) => s.accessLevel !== "secondary"),
    [sections]
  );
  const departmentNames = useMemo(
    () => Array.from(new Set(students.map((s) => s.department).filter(Boolean))).sort(),
    [students]
  );
  const distDepartments = useMemo(
    () => Array.from(new Set(managedSections.map((s) => s.department).filter(Boolean))).sort(),
    [managedSections]
  );
  const distYears = useMemo(
    () => Array.from(new Set(managedSections.filter((s) => s.department === distDept).map((s) => s.year))).sort((a, b) => a - b),
    [managedSections, distDept]
  );
  const distTargetSections = useMemo(
    () => managedSections
      .filter((s) => s.department === distDept && String(s.year) === distYear)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [managedSections, distDept, distYear]
  );
  const unassignedCount = useMemo(
    () => students.filter((s) => s.department === distDept && String(s.year) === distYear && !s.section).length,
    [students, distDept, distYear]
  );

  const filtered = useMemo(
    () => (deptFilter === "all" ? students : students.filter((s) => s.department === deptFilter)),
    [students, deptFilter]
  );

  // The cohort action belongs to the main HOD of a shared first-year department
  // only - a core branch HOD sections their own students with the per-department
  // dialog. Derived with the same helper the API uses, so both agree.
  const structure = useMemo(
    () => structureFromDepartments(departments as DepartmentWithId[]),
    [departments]
  );
  const cohortYear = structure.commonYears[0];
  const isCommonYearHod =
    structure.isCommonFirstYear &&
    !!myDepartment &&
    structure.commonDepartment?.name === myDepartment;
  const cohortUnassignedCount = useMemo(
    () => (cohortYear ? students.filter((s) => s.year === cohortYear && !s.section).length : 0),
    [students, cohortYear]
  );

  async function handleDistributeCohort() {
    if (!cohortYear) return;
    setIsDistributingCohort(true);
    try {
      const res = await fetch("/api/college/students/distribute-cohort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: cohortYear }),
      });
      const json = await res.json() as {
        error?: string; distributed?: number; perBranch?: CohortBranchResult[];
      };
      if (!res.ok) {
        // A failed run can still carry per-branch detail (e.g. every branch is
        // missing sections) - surface it rather than just the message.
        setCohortResult(json.perBranch ?? null);
        throw new Error(json.error ?? "Failed to distribute");
      }
      setCohortResult(json.perBranch ?? []);
      toast({ variant: "success", title: `Distributed ${json.distributed} students` });
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to distribute" });
    } finally {
      setIsDistributingCohort(false);
    }
  }

  function toggleDistSection(id: string, checked: boolean) {
    setDistSectionIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  }

  function openEdit(student: StudentRow) {
    setEditTarget(student);
    setEditRoll(student.rollNumber ?? "");
    setEditStatus(student.status ?? "REGULAR");
  }

  async function handleSaveEdit() {
    if (!editTarget) return;
    setIsSavingEdit(true);
    try {
      const res = await fetch(`/api/college/students/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rollNumber: editRoll.trim(), status: editStatus }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to update student");
      toast({ variant: "success", title: "Student updated" });
      setEditTarget(null);
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to update student" });
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleDistribute() {
    if (!distDept || !distYear || distSectionIds.length === 0) {
      toast({ variant: "destructive", title: "Pick a department, year, and at least one section" });
      return;
    }
    setIsDistributing(true);
    try {
      const res = await fetch("/api/college/students/distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department: distDept, year: Number(distYear), sectionIds: distSectionIds }),
      });
      const json = await res.json() as { error?: string; distributed?: number; perSection?: { section: string; count: number }[] };
      if (!res.ok) throw new Error(json.error ?? "Failed to distribute");
      const summary = (json.perSection ?? []).map((p) => `${p.section}: ${p.count}`).join(", ");
      toast({ variant: "success", title: `Distributed ${json.distributed} students`, description: summary });
      setDistributeOpen(false);
      setDistSectionIds([]);
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to distribute" });
    } finally {
      setIsDistributing(false);
    }
  }

  const columns: Column<StudentRow>[] = [
    { key: "rollNumber", header: "Roll No", render: (r) => <span className="font-medium">{r.rollNumber || "—"}</span> },
    { key: "name", header: "Name" },
    { key: "department", header: "Department", hideOnMobile: true, render: (r) => <span className="text-sm text-muted-foreground">{r.department}</span> },
    {
      key: "section",
      header: "Section",
      render: (r) =>
        r.section
          ? <span>{r.section}</span>
          : <Badge variant="outline" className="text-amber-600 border-amber-300">Unassigned</Badge>,
    },
    { key: "year", header: "Year", hideOnMobile: true, render: (r) => <span>{r.year}</span> },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge variant={STATUS_VARIANTS[r.status] ?? "secondary"}>{r.status}</Badge>,
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <Button variant="ghost" size="sm" onClick={() => openEdit(r)} title="Set roll number / status">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description="Your department's students, plus every branch grouped under it. Divide unassigned students evenly across sections in full-name order."
        actions={
          <>
          {isCommonYearHod && (
            <Dialog open={cohortOpen} onOpenChange={(open) => { setCohortOpen(open); if (!open) setCohortResult(null); }}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Layers className="h-4 w-4 mr-2" />
                  Distribute All {cohortYear ? yearOrdinalLabel(cohortYear) : ""} Students
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    Distribute the whole {cohortYear ? yearOrdinalLabel(cohortYear) : ""} intake
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">
                    Every unassigned student is placed into a section of <strong>their own branch</strong> - an IT
                    student always lands in an IT section, never in a sub-department. Within each branch they are
                    sorted by full name and split evenly across that branch&apos;s sections. Branches with no
                    sections yet are reported and left untouched.
                  </p>
                  <p className="text-sm">
                    <strong>{cohortUnassignedCount}</strong> unassigned student
                    {cohortUnassignedCount === 1 ? "" : "s"} across{" "}
                    {structure.subDepartments.length} sub-department
                    {structure.subDepartments.length === 1 ? "" : "s"}.
                  </p>

                  {cohortResult && (
                    <div className="space-y-2 rounded-md border p-3 max-h-64 overflow-y-auto">
                      {cohortResult.map((b) => (
                        <div key={b.branch} className="text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{b.branch}</span>
                            {b.skippedReason ? (
                              <Badge variant="outline" className="text-amber-600 border-amber-300">Skipped</Badge>
                            ) : (
                              <span className="text-muted-foreground">{b.distributed} placed</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {b.skippedReason
                              ?? b.perSection.map((p) => `${p.section}: ${p.count}`).join(", ")}
                            {b.managedBy && !b.skippedReason ? ` · managed by ${b.managedBy}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setCohortOpen(false)}>Close</Button>
                  <Button
                    onClick={() => void handleDistributeCohort()}
                    loading={isDistributingCohort}
                    disabled={cohortUnassignedCount === 0}
                  >
                    Distribute All
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          <Dialog open={distributeOpen} onOpenChange={(open) => { setDistributeOpen(open); if (!open) setDistSectionIds([]); }}>
            <DialogTrigger asChild>
              <Button><Shuffle className="h-4 w-4 mr-2" />Distribute Unassigned</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Distribute Unassigned Students</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Unassigned students are sorted by full name and split evenly across the sections you pick - earliest
                  names fill the first section, and so on. Roll numbers stay as imported.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Department</Label>
                    <Select value={distDept} onValueChange={(v) => { setDistDept(v); setDistYear(""); setDistSectionIds([]); }}>
                      <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                      <SelectContent>
                        {distDepartments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Year</Label>
                    <Select value={distYear} onValueChange={(v) => { setDistYear(v); setDistSectionIds([]); }} disabled={!distDept}>
                      <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                      <SelectContent>
                        {distYears.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {distDept && distYear && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Target Sections</Label>
                      <span className="text-xs text-muted-foreground">{unassignedCount} unassigned to divide</span>
                    </div>
                    {distTargetSections.length > 0 ? (
                      <div className="flex flex-wrap gap-3 border rounded-md px-3 py-2">
                        {distTargetSections.map((s) => (
                          <label key={s.id} className="flex items-center gap-1.5 text-sm">
                            <Checkbox
                              checked={distSectionIds.includes(s.id)}
                              onCheckedChange={(checked) => toggleDistSection(s.id, !!checked)}
                            />
                            {s.name}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">
                        No sections for {distDept} Year {distYear} yet - create them under Sections first.
                      </p>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDistributeOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => void handleDistribute()}
                  loading={isDistributing}
                  disabled={unassignedCount === 0 || distSectionIds.length === 0}
                >
                  Distribute
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </>
        }
      />

      <DataTable
        data={filtered}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id}
        searchPlaceholder="Search by roll number or name..."
        searchKeys={["rollNumber", "name"] as (keyof StudentRow)[]}
        emptyTitle="No students yet"
        emptyDescription="Once the College Office imports your branches' students, they show up here to be sectioned."
        filterComponent={
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All departments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departmentNames.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {editTarget?.department} · Year {editTarget?.year} · {editTarget?.section ? `Section ${editTarget.section}` : "Unassigned"}
            </p>
            <div className="space-y-2">
              <Label htmlFor="edit-roll">Roll Number</Label>
              <Input
                id="edit-roll"
                value={editRoll}
                onChange={(e) => setEditRoll(e.target.value)}
                placeholder="e.g. 21A91A0501"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">Leave blank to keep the student roll-less for now.</p>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="REGULAR">Regular</SelectItem>
                  <SelectItem value="DETAINED">Detained</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={() => void handleSaveEdit()} loading={isSavingEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
