"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Network, Plus, Users, BookMarked, UserCog, Trash2, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DepartmentChipList } from "@/components/shared/DepartmentChipList";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import { toast } from "@/hooks/useToast";
import { replaceNoOwnSectionsParents, type DepartmentWithId } from "@/lib/college/academicStructure";
import type { Department, Section, StudentListItem } from "@/types";

interface SubDeptSummary {
  dept: Department;
  studentCount: number;
  sectionCount: number;
}

export default function SubDepartmentsSettingsPage() {
  const myDepartments = useMyDepartments();
  const searchParams = useSearchParams();
  // Which of this HOD's own departments Sub-Departments is currently showing -
  // only choosable when they head more than one (see useMyDepartments).
  // `pickedDept` holds only an explicit user choice; `department` (derived,
  // not stored - not `user.department` either, a bare primitive rather than
  // reading the auth store's `user` object directly here, which previously
  // caused a loading -> loaded -> loading flicker: useAuth's onIdTokenChanged
  // legitimately re-fires with a new `user` reference shortly after sign-in
  // even when nothing relevant changed, retriggering the whole load a second
  // time) falls back to the first owned department, so nothing needs syncing
  // via an effect when the department list itself loads/changes.
  // Seeded from `?dept=` so returning from the Add Sub-Department page lands
  // back on the same one of this HOD's several departments, not the first.
  const [pickedDept, setPickedDept] = useState(() => searchParams.get("dept") ?? "");
  const department = pickedDept && myDepartments.includes(pickedDept) ? pickedDept : myDepartments[0] ?? "";
  const [ownDept, setOwnDept] = useState<Department | null>(null);
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [children, setChildren] = useState<SubDeptSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!department) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [deptsRes, sectionsRes, studentsRes] = await Promise.all([
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
        fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections: (Section & { id: string })[] }>),
        fetch("/api/college/students").then((r) => r.json() as Promise<{ students: StudentListItem[] }>),
      ]);

      const departments = deptsRes.departments ?? [];
      const mine = departments.find((d) => d.name === department) ?? null;
      setOwnDept(mine);
      setAllDepartments(departments);

      if (mine) {
        const childDepts = departments.filter((d) => d.parentDepartmentId === mine.id);
        const sections = sectionsRes.sections ?? [];
        const students = studentsRes.students ?? [];
        setChildren(
          childDepts.map((dept) => {
            // Real sections are filed under the real branch's own name (e.g.
            // "CIVIL ENGINEERING"), never this sub-department's own name -
            // count by its managed branches instead, same as
            // hod/sections/page.tsx's identical count. A shared-first-year
            // STUDENT is different: they stay filed under their common
            // department (department unchanged) until promotion, with
            // secondaryDepartment naming their real branch (see
            // students/[id] PATCH) - so a student counts here when EITHER
            // field is one of this sub-department's managed branches.
            // Narrowed first: a grouped department that runs no sections of
            // its own never appears on a section or a student - its children
            // do - so counting by the stored name alone reported 0.
            const branchNames = new Set(
              replaceNoOwnSectionsParents(departments as DepartmentWithId[], dept.managedDepartments ?? [])
            );
            return {
              dept,
              studentCount: students.filter((s) => branchNames.has(s.department) || branchNames.has(s.secondaryDepartment ?? "")).length,
              sectionCount: sections.filter((s) => branchNames.has(s.department)).length,
            };
          })
        );
      } else {
        setChildren([]);
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load sub-departments" });
    } finally {
      setIsLoading(false);
    }
  }, [department]);

  useEffect(() => {
    // Awaited in a wrapper so the loader's setState calls aren't reachable
    // synchronously from the effect body (react-hooks/set-state-in-effect).
    void (async () => {
        await load();
    })();
  }, [load]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/departments?deptId=${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to delete");

      toast({ variant: "success", title: `${deleteTarget.name} removed` });
      setDeleteTarget(null);
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to delete" });
    } finally {
      setIsDeleting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Sub-Departments" description="Loading…" />
        <div className="space-y-2">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
      </div>
    );
  }


  // Sub-departments are one level deep only - a sub-department can never
  // have sub-departments of its own, so a Sub-HOD landing here (e.g. a stale
  // link, since the nav hides this for them) gets a message that actually
  // applies to them, not the "ask your Principal to enable it" one meant for
  // a plain top-level department.
  if (ownDept?.parentDepartmentId) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Sub-Departments"
          description="Split your department into sub-branches, each with its own HOD"
        />
        <Card>
          <CardContent className="py-16">
            <EmptyState
              title="Not available for a sub-department"
              description="Sub-departments are one level deep only - your department can't be split further."
              icon={<Network className="h-8 w-8" />}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Only choosable when this HOD heads more than one department - a plain
  // single-department HOD sees nothing extra.
  const deptPicker = myDepartments.length > 1 ? (
    <div className="max-w-xs space-y-1.5">
      <Label htmlFor="sub-dept-top">Department</Label>
      <Select value={department} onValueChange={setPickedDept}>
        <SelectTrigger id="sub-dept-top"><SelectValue /></SelectTrigger>
        <SelectContent>
          {myDepartments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  ) : null;

  if (!ownDept?.hasSubDepartments) {
    return (
      <div className="space-y-6">
        {deptPicker}
        <PageHeader
          title="Sub-Departments"
          description="Split your department into sub-branches, each with its own HOD"
        />
        <Card>
          <CardContent className="py-16">
            <EmptyState
              title="Sub-departments aren't enabled for your department"
              description="Ask your Principal to enable sub-departments for your department before you can add sub-departments and assign sub-HODs."
              icon={<Network className="h-8 w-8" />}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {deptPicker}
      <PageHeader
        title="Sub-Departments"
        description={`Add sub-departments under ${ownDept.name}, assign each its own Sub-HOD, and group whole branches under them - the Sub-HOD then fully manages those branches' students and sections.`}
        actions={
          <Button asChild>
            <Link href={`/hod/settings/sub-departments/${ownDept.id}/new`}>
              <Plus className="h-4 w-4 mr-2" />Add Sub-Department
            </Link>
          </Button>
        }
      />

      {children.length === 0 ? (
        <Card>
          <CardContent className="py-16">
            <EmptyState
              title="No sub-departments yet"
              description="Add your first sub-department to split this department into sub-branches, each run by its own Sub-HOD."
              icon={<Network className="h-8 w-8" />}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {children.map(({ dept, studentCount, sectionCount }) => (
            <Card key={dept.id}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{dept.name}</p>
                    <Badge variant="secondary" className="text-xs mt-1">{dept.code}</Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <Link
                      href={`/hod/settings/sub-departments/${dept.id}/edit`}
                      className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground"
                      title="Edit sub-department (name, code, Sub-HOD, grouped departments)"
                      aria-label={`Edit ${dept.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Link>
                    <button
                      onClick={() => setDeleteTarget(dept)}
                      className="p-1.5 rounded-md hover:bg-destructive/10 transition-colors text-destructive"
                      title="Delete sub-department"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <UserCog className="h-4 w-4 text-muted-foreground shrink-0" />
                  {dept.hodName
                    ? <span><strong>{dept.hodName}</strong> - Sub-HOD</span>
                    : <span className="text-muted-foreground italic">No Sub-HOD assigned</span>}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="h-4 w-4 shrink-0" />
                  <span><strong className="text-foreground">{studentCount}</strong> students</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <BookMarked className="h-4 w-4 shrink-0" />
                  <span><strong className="text-foreground">{sectionCount}</strong> sections</span>
                </div>
                {dept.managedDepartments && dept.managedDepartments.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">Core Departments</p>
                    <DepartmentChipList
                      names={replaceNoOwnSectionsParents(allDepartments as DepartmentWithId[], dept.managedDepartments)}
                      className="mt-1"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={`Delete ${deleteTarget?.name ?? ""}?`}
        description={`This removes ${deleteTarget?.name ?? "this sub-department"} and its Sub-HOD assignment. It can only be deleted while it has no students or sections.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />
    </div>
  );
}
