"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, CheckCircle2, Upload, Layers, ArrowLeft, ChevronRight, MoveRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FreshmanDepartmentBadge } from "@/components/shared/FreshmanDepartmentBadge";
import { toast } from "@/hooks/useToast";
import { yearOrdinalLabel } from "@/lib/college/academicYears";
import { resolveDepartmentCourseScope, type DepartmentWithId } from "@/lib/college/academicStructure";
import { RoleAssignmentsPage } from "@/components/roles/RoleAssignmentsPage";
import { SectionCard } from "@/components/academics/SectionsPanel";
import { SectionRoster } from "@/components/academics/SectionRoster";
import { sectionsOfDepartment, isFiledUnderDepartment } from "@/lib/departments/departmentSections";
import { isContainerDepartment } from "@/lib/departments/departmentTree";
import type { Course, Department, Section } from "@/types";

type DeptWithMaybeId = Department & { id: string };

interface MigrationCounts {
  sectionsRenamed: number;
  sectionsSkippedConflict: number;
  studentsMoved: number;
  subjectAssignmentsMoved: number;
  subjectAssignmentsDeduped: number;
  teachingAssignmentsRepointed: number;
  timetableSlotsRepointed: number;
}

type PreviewEntry = ({ ok: true } & MigrationCounts) | { ok: false; error: string };

async function callMigrateRoute(subDepartmentId: string, branchDepartmentId: string, dryRun: boolean): Promise<MigrationCounts> {
  const res = await fetch("/api/college/departments/migrate-managed-branch-subjects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subDepartmentId, branchDepartmentId, dryRun }),
  });
  const json = await res.json() as MigrationCounts & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Failed");
  return json;
}

// Dry-run preview, then confirm, moving a sub-department's shared-year
// subjects/teaching-assignments/timetable rows over to each of its managed
// core departments directly (see src/lib/departments/migrateManagedBranchSubjects.ts).
function MoveSubjectsDialog({ open, onOpenChange, subDepartment, branches }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subDepartment: DeptWithMaybeId;
  branches: { id: string; name: string }[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Record<string, PreviewEntry> | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(branches.map((b) => b.id)));
    setPreview(null);
  }, [open, branches]);

  async function runPreview() {
    setIsLoadingPreview(true);
    try {
      const picked = branches.filter((b) => selected.has(b.id));
      const entries = await Promise.all(picked.map(async (b): Promise<[string, PreviewEntry]> => {
        try {
          const counts = await callMigrateRoute(subDepartment.id, b.id, true);
          return [b.id, { ok: true, ...counts }];
        } catch (err) {
          return [b.id, { ok: false, error: err instanceof Error ? err.message : "Failed" }];
        }
      }));
      setPreview(Object.fromEntries(entries));
    } finally {
      setIsLoadingPreview(false);
    }
  }

  async function confirmMove() {
    setIsConfirming(true);
    try {
      const picked = branches.filter((b) => selected.has(b.id));
      const results = await Promise.allSettled(picked.map((b) => callMigrateRoute(subDepartment.id, b.id, false).then(() => b.name)));
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - succeeded;
      toast({
        variant: failed === 0 ? "success" : "destructive",
        title: failed === 0 ? `Moved subjects for ${succeeded} department${succeeded !== 1 ? "s" : ""}` : `${succeeded} moved, ${failed} failed`,
        description: failed > 0
          ? results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason?.message ?? "Failed").join("; ")
          : undefined,
      });
      if (succeeded > 0) onOpenChange(false);
    } finally {
      setIsConfirming(false);
    }
  }

  const totals = preview
    ? Object.values(preview).reduce((acc, p) => {
        if (!p.ok) return acc;
        return {
          sectionsRenamed: acc.sectionsRenamed + p.sectionsRenamed,
          sectionsSkippedConflict: acc.sectionsSkippedConflict + p.sectionsSkippedConflict,
          studentsMoved: acc.studentsMoved + p.studentsMoved,
          subjectAssignmentsMoved: acc.subjectAssignmentsMoved + p.subjectAssignmentsMoved,
          subjectAssignmentsDeduped: acc.subjectAssignmentsDeduped + p.subjectAssignmentsDeduped,
          teachingAssignmentsRepointed: acc.teachingAssignmentsRepointed + p.teachingAssignmentsRepointed,
          timetableSlotsRepointed: acc.timetableSlotsRepointed + p.timetableSlotsRepointed,
        };
      }, { sectionsRenamed: 0, sectionsSkippedConflict: 0, studentsMoved: 0, subjectAssignmentsMoved: 0, subjectAssignmentsDeduped: 0, teachingAssignmentsRepointed: 0, timetableSlotsRepointed: 0 })
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move subjects &amp; students to core departments</DialogTitle>
          <DialogDescription>
            Renames the shared-year sections (and the students in them) currently filed under &quot;{subDepartment.name}&quot;
            to each selected core department directly, and moves their subjects, teaching assignments and timetable rows
            along with them. This changes live student records - nothing is written until you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {branches.map((b) => (
            <label key={b.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.has(b.id)}
                onCheckedChange={(checked) => {
                  setPreview(null);
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (checked) next.add(b.id); else next.delete(b.id);
                    return next;
                  });
                }}
              />
              <span className="flex-1">{b.name}</span>
              {preview?.[b.id] && (
                !preview[b.id].ok
                  ? <span className="text-xs text-destructive">{(preview[b.id] as { ok: false; error: string }).error}</span>
                  : <span className="text-xs text-muted-foreground">
                      {(preview[b.id] as MigrationCounts).sectionsRenamed} sections, {(preview[b.id] as MigrationCounts).studentsMoved} students, {(preview[b.id] as MigrationCounts).subjectAssignmentsMoved} subjects
                      {(preview[b.id] as MigrationCounts).sectionsSkippedConflict > 0 && <span className="text-amber-600"> ({(preview[b.id] as MigrationCounts).sectionsSkippedConflict} skipped - name conflict)</span>}
                    </span>
              )}
            </label>
          ))}
        </div>

        {totals && (
          <p className="text-xs text-muted-foreground border-t pt-3">
            This will rename {totals.sectionsRenamed} section{totals.sectionsRenamed !== 1 ? "s" : ""} and move {totals.studentsMoved} student{totals.studentsMoved !== 1 ? "s" : ""}
            {totals.sectionsSkippedConflict > 0 ? ` (${totals.sectionsSkippedConflict} section${totals.sectionsSkippedConflict !== 1 ? "s" : ""} skipped - a section with the same name/year already exists under the core department)` : ""},
            move {totals.subjectAssignmentsMoved} subject{totals.subjectAssignmentsMoved !== 1 ? "s" : ""}
            {totals.subjectAssignmentsDeduped > 0 ? ` (discarding ${totals.subjectAssignmentsDeduped} already duplicated under the core department)` : ""},
            and repoint {totals.teachingAssignmentsRepointed} teaching assignment{totals.teachingAssignmentsRepointed !== 1 ? "s" : ""} and {totals.timetableSlotsRepointed} timetable row{totals.timetableSlotsRepointed !== 1 ? "s" : ""} across {Object.keys(preview ?? {}).length} department{Object.keys(preview ?? {}).length !== 1 ? "s" : ""} - review before confirming.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!preview ? (
            <Button onClick={() => void runPreview()} disabled={selected.size === 0 || isLoadingPreview}>
              {isLoadingPreview ? "Checking..." : "Preview"}
            </Button>
          ) : (
            <Button onClick={() => void confirmMove()} disabled={isConfirming || (totals?.subjectAssignmentsMoved ?? 0) + (totals?.subjectAssignmentsDeduped ?? 0) === 0}>
              {isConfirming ? "Moving..." : "Confirm & Move"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Sections by year, ascending, each year's own list by name. */
function groupByYear(list: Section[]): [number, Section[]][] {
  const map = new Map<number, Section[]>();
  for (const s of list) map.set(s.year, [...(map.get(s.year) ?? []), s]);
  for (const group of map.values()) group.sort((a, b) => a.name.localeCompare(b.name));
  return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
}

// In-place drill-down for one top-level department: sub-departments (if it has
// any) -> that sub-department's sections -> a section's student roster. All of
// it renders inside the Departments toggle - nothing navigates away.
//
// A department can have sub-departments AND run sections of its own (CSE ->
// Cyber Security, ECE -> VLSI). It then lists both: the sub-department cards and
// its own sections. Only a pure container (Basic Science: it organises
// sub-departments and nothing is filed under it) lists the cards alone.
function DepartmentDrillDown({ departments, courses, rootId, onExit }: {
  departments: Department[];
  courses: Course[];
  rootId: string;
  onExit: () => void;
}) {
  const router = useRouter();
  const [path, setPath] = useState<string[]>([rootId]);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [movingSubDept, setMovingSubDept] = useState<DeptWithMaybeId | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections?: Section[] }>);
        setSections(res.sections ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load sections" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const byId = (id: string) => departments.find((d) => d.id === id);
  const current = byId(path[path.length - 1]);
  const children = current ? departments.filter((d) => d.parentDepartmentId === current.id) : [];
  // courseId -> catalogId: a manager's years are decided per course, so each section is resolved against its own course.
  const catalogIdByCourseId = useMemo(() => new Map(courses.map((c) => [c.id, c.catalogId])), [courses]);
  // What is filed directly under this department. For a container this is normally empty; it is
  // still listed when it isn't, so a section filed under a parent is never hidden by it having children.
  const filedHere = useMemo(
    () => (current ? sections.filter((s) => isFiledUnderDepartment(current as DeptWithMaybeId, s)) : []),
    [current, sections]
  );
  // `undefined` while sections load: nothing is guessed about a department until its sections are known.
  const isContainer = current ? isContainerDepartment(current, departments, isLoading ? undefined : filedHere.length > 0) : false;
  const deptSections = useMemo(() => {
    if (!current) return [];
    // A container keeps its old look (cards only); the direct-filed list is just the safety net above.
    if (children.length > 0 && isContainer) return filedHere;
    return sectionsOfDepartment(current as DeptWithMaybeId, departments, sections, catalogIdByCourseId);
  }, [current, departments, sections, catalogIdByCourseId, children.length, isContainer, filedHere]);
  const byYear = useMemo(() => {
    const map = new Map<number, Section[]>();
    for (const s of deptSections) map.set(s.year, [...(map.get(s.year) ?? []), s]);
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [deptSections]);

  // Each sub-department's own sections, so the parent's page shows everything in
  // its tree rather than only what is filed directly under it. VWU's Computer
  // Science and Engineering runs 9 sections of its own and CSE [CYBER SECURITY]
  // another 3; all 12 belong on that page, each under the name of the
  // department that owns it. A sub-department owns its own years outright
  // (sectionsOfDepartment resolves the owner per year), so nothing is listed
  // twice.
  const childGroups = useMemo(() => {
    if (!current) return [];
    return departments
      .filter((d) => d.parentDepartmentId === current.id)
      .map((owner) => ({
        owner,
        byYear: groupByYear(sectionsOfDepartment(owner as DeptWithMaybeId, departments, sections, catalogIdByCourseId)),
      }))
      .filter((g) => g.byYear.length > 0);
  }, [current, departments, sections, catalogIdByCourseId]);

  if (!current) return null;
  if (openSectionId) {
    return <SectionRoster sectionId={openSectionId} onBack={() => setOpenSectionId(null)} backLabel={`Back to ${current.name}`} />;
  }

  const goBack = () => (path.length > 1 ? setPath(path.slice(0, -1)) : onExit());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button className="text-muted-foreground hover:text-foreground" onClick={onExit}>Departments</button>
          {path.map((id, i) => (
            <span key={id} className="flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <button
                className={i === path.length - 1 ? "font-semibold" : "text-muted-foreground hover:text-foreground"}
                onClick={() => setPath(path.slice(0, i + 1))}
              >
                {byId(id)?.name}
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          {/* Sub-department cards below (children.map) are navigation-only -
              nothing in this drill-down previously linked to the edit form,
              so a sub-department's name/code could never actually be
              changed once inside it. Mirrors the top-level grid's own Edit
              pencil (same /edit route, works for any department id). */}
          <Button variant="outline" size="sm" onClick={() => router.push(`/principal/departments/${current.id}/edit`)}>
            <Pencil className="h-4 w-4 mr-1" />Edit
          </Button>
          <Button variant="outline" size="sm" onClick={goBack}>
            <ArrowLeft className="h-4 w-4 mr-1" />Back
          </Button>
        </div>
      </div>

      <PageHeader
        title={current.name}
        description={
          children.length === 0
            ? "Select a section to see its students"
            : deptSections.length > 0
              ? "Open a sub-department, or one of this department's own sections"
              : "Select a sub-department to see its sections"
        }
      />

      {children.length > 0 && (
        <div className="space-y-3">
          {deptSections.length > 0 && <h2 className="font-semibold text-base">Sub-departments</h2>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {children.map((c) => (
              <Card key={c.id} className="cursor-pointer transition-colors hover:border-primary/50" onClick={() => setPath([...path, c.id])}>
                <CardContent className="p-4">
                  <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-1.5 rounded bg-muted text-xs font-mono font-semibold text-muted-foreground mb-1">{c.code}</span>
                  <p className="font-semibold text-sm leading-tight">{c.name}</p>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {c.hodName ? `HOD: ${c.hodName}` : "No HOD assigned"}
                  </p>
                  {(c.managedDepartments ?? []).length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs mt-2 w-full"
                      onClick={(e) => { e.stopPropagation(); setMovingSubDept(c as DeptWithMaybeId); }}
                    >
                      <MoveRight className="h-3.5 w-3.5 mr-1" />Move subjects to core depts
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {children.length === 0 && isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : byYear.length === 0 ? (
        children.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No sections in this department yet.</CardContent></Card>
        ) : null
      ) : (
        <div className="space-y-8">
          {children.length > 0 && <h2 className="font-semibold text-base">{current.name} - own sections</h2>}
          {byYear.map(([year, list]) => (
            <div key={year}>
              <h3 className={children.length > 0 ? "font-semibold text-sm text-muted-foreground mb-3" : "font-semibold text-base mb-3"}>{yearOrdinalLabel(year)}</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((sec) => <SectionCard key={sec.id} sec={sec} onOpen={() => setOpenSectionId(sec.id)} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Each sub-department's own sections, under its name. */}
      {childGroups.map(({ owner, byYear: childYears }) => (
        <div key={owner.id} className="space-y-8">
          <h2 className="font-semibold text-base">{owner.name} - own sections</h2>
          {childYears.map(([year, list]) => (
            <div key={year}>
              <h3 className="font-semibold text-sm text-muted-foreground mb-3">{yearOrdinalLabel(year)}</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((sec) => <SectionCard key={sec.id} sec={sec} onOpen={() => setOpenSectionId(sec.id)} />)}
              </div>
            </div>
          ))}
        </div>
      ))}

      {movingSubDept && (
        <MoveSubjectsDialog
          open={!!movingSubDept}
          onOpenChange={(open) => !open && setMovingSubDept(null)}
          subDepartment={movingSubDept}
          branches={(movingSubDept.managedDepartments ?? [])
            .map((name) => departments.find((d) => d.name === name) as DeptWithMaybeId | undefined)
            .filter((d): d is DeptWithMaybeId => !!d)
            .map((d) => ({ id: d.id, name: d.name }))}
        />
      )}
    </div>
  );
}

export function DepartmentsPanel() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingDept, setDeletingDept] = useState<Department | null>(null);
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [showRoles, setShowRoles] = useState(false);

  // Only parents are listed here. A sub-department (e.g. BS-Chemistry under
  // Basic Science) is not a peer of its parent, so it would be misleading as a
  // top-level card - it's reached by opening the parent instead.
  const topLevelDepartments = departments.filter((d) => !d.parentDepartmentId);
  const childrenOf = (parentId: string) =>
    departments.filter((d) => d.parentDepartmentId === parentId);
  const coursesOf = (departmentId: string) =>
    courses.filter((c) => c.departmentId === departmentId).sort((a, b) => a.name.localeCompare(b.name));

  async function loadDepts() {
    setIsLoading(true);
    try {
      // No `departmentId` - a non-HOD caller gets every Course doc in the
      // college in one call, so each department's cards can show its own
      // courses' years/cross-listing instead of one blended department-wide
      // badge (a department can offer several courses with different
      // structures - see resolveDepartmentCourseScope).
      const [deptRes, coursesRes] = await Promise.all([
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
        fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
      ]);
      setDepartments(deptRes.departments ?? []);
      setCourses(coursesRes.courses ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load departments" });
    } finally {
      setIsLoading(false);
    }
  }

  // Awaited in a wrapper so loadDepts()'s setState calls aren't reachable
  // synchronously from the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    void (async () => { await loadDepts(); })();
  }, []);

  async function handleDelete(dept: Department) {
    try {
      const res = await fetch(`/api/college/departments?deptId=${encodeURIComponent(dept.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed");
      }
      toast({ variant: "success", title: "Department removed" });
      setDepartments((prev) => prev.filter((d) => d.id !== dept.id));
    } catch (err) {
      // The server refuses a delete that would orphan data and says exactly
      // what is in the way ("still has sub-departments", "still has students
      // or sections", ...). That message was being swallowed here, leaving
      // "Failed to remove department" with no way to tell what to clear first.
      toast({
        variant: "destructive",
        title: `Couldn't remove ${dept.name}`,
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setDeletingDept(null);
    }
  }

  // Role Assignments renders in place too; HODs may change there, so reload
  // the department cards on the way back.
  if (showRoles) {
    return (
      <div className="space-y-6">
        <Button variant="outline" size="sm" onClick={() => { setShowRoles(false); void loadDepts(); }}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back to Departments
        </Button>
        <RoleAssignmentsPage />
      </div>
    );
  }

  if (selectedDeptId) {
    return <DepartmentDrillDown departments={departments} courses={courses} rootId={selectedDeptId} onExit={() => setSelectedDeptId(null)} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Departments"
        description="Manage college departments and assign Heads of Department"
        actions={
          <>
            <Button variant="outline" onClick={() => router.push("/principal/departments/import")}>
              <Upload className="h-4 w-4 mr-2" />
              Import
            </Button>
            <Button onClick={() => router.push("/principal/departments/new")}>
              <Plus className="h-4 w-4 mr-2" />
              Add Department
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-lg border bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : topLevelDepartments.length === 0 ? (
        <Card>
          {/* No second "Add Department" button here - the page header already
              carries one, and on an empty page the two sat a few centimetres
              apart doing the same thing. The message points at the one above. */}
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground">No departments yet. Use <span className="font-medium text-foreground">Add Department</span> above to create your first one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {topLevelDepartments.map((dept) => {
            const deptCourses = coursesOf(dept.id);
            const subDeptCount = childrenOf(dept.id).length;
            return (
              <Card
                key={dept.id}
                className={`flex flex-col cursor-pointer transition-colors hover:border-primary/50 ${!dept.isActive ? "opacity-60" : ""}`}
                onClick={() => setSelectedDeptId(dept.id)}
              >
                <CardContent className="flex flex-col flex-1 p-4">
                  {/* Header: code + actions */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center h-7 min-w-[1.75rem] px-1.5 rounded bg-muted text-xs font-mono font-semibold text-muted-foreground">
                        {dept.code}
                      </span>
                      <FreshmanDepartmentBadge departmentId={dept.id} allDepartments={departments as DepartmentWithId[]} />
                      {!dept.isActive && <span className="text-[10px] font-medium text-orange-500 uppercase tracking-wide">Inactive</span>}
                    </div>
                    <div className="flex gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Edit department"
                        onClick={() => router.push(`/principal/departments/${dept.id}/edit`)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title="Delete department"
                        onClick={() => setDeletingDept(dept)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Name */}
                  <p className="font-semibold text-sm mt-2 leading-snug">{dept.name}</p>

                  {/* HOD */}
                  <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                    {dept.hodName && dept.hodUid ? (
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                        <p className="text-xs text-muted-foreground truncate">HOD: {dept.hodName}</p>
                      </div>
                    ) : (
                      <p className="text-xs text-orange-500">No HOD assigned</p>
                    )}
                  </div>

                  {/* Course + Year info - concise text only */}
                  <div className="mt-2 space-y-1 flex-1">
                    {deptCourses.length > 0 ? (
                      deptCourses.map((c) => {
                        const scope = resolveDepartmentCourseScope(dept, c.catalogId);
                        const yearsText = scope.assignedYears.length > 0
                          ? scope.assignedYears.map(yearOrdinalLabel).join(", ")
                          : "No years assigned";
                        return (
                          <p key={c.id} className="text-xs text-muted-foreground line-clamp-1">
                            <span className="font-medium text-foreground">{c.name}:</span>{" "}{yearsText}
                          </p>
                        );
                      })
                    ) : dept.assignedYears && dept.assignedYears.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {dept.assignedYears.map(yearOrdinalLabel).join(", ")}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">No courses configured</p>
                    )}

                    {subDeptCount > 0 && (
                      <p className="text-xs text-muted-foreground">
                        <Layers className="inline h-3 w-3 mr-1 -mt-px" />
                        {subDeptCount} sub-department{subDeptCount !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-border/50" onClick={(e) => e.stopPropagation()}>
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                    >
                      <Link href={`/principal/departments/${dept.id}`}>Manage courses &amp; timings</Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => setShowRoles(true)}
                    >
                      Role Assignments
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!deletingDept}
        onOpenChange={(open) => !open && setDeletingDept(null)}
        title="Remove Department?"
        description={`"${deletingDept?.name}" will be removed. Existing vacancy requests and candidates linked to this department are NOT affected.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => { if (deletingDept) void handleDelete(deletingDept); }}
      />
    </div>
  );
}
