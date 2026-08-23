"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, CheckCircle2, Upload, Layers } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ManageHodDepartmentsDialog } from "@/components/college/ManageHodDepartmentsDialog";
import { FreshmanDepartmentBadge } from "@/components/shared/FreshmanDepartmentBadge";
import { DepartmentChipList } from "@/components/shared/DepartmentChipList";
import { toast } from "@/hooks/useToast";
import { yearOrdinalLabel } from "@/lib/college/academicYears";
import { resolveDepartmentCourseScope, type DepartmentWithId } from "@/lib/college/academicStructure";
import type { Course, Department, FMSUser } from "@/types";

export default function DepartmentsPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [hods, setHods] = useState<FMSUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingDept, setDeletingDept] = useState<Department | null>(null);

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
      const [deptRes, coursesRes, hodsRes] = await Promise.all([
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
        fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
        fetch("/api/college/users?role=HOD&allDepts=true").then((r) => r.json() as Promise<{ users: FMSUser[] }>),
      ]);
      setDepartments(deptRes.departments ?? []);
      setCourses(coursesRes.courses ?? []);
      setHods(hodsRes.users ?? []);
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
    } catch {
      toast({ variant: "destructive", title: "Failed to remove department" });
    } finally {
      setDeletingDept(null);
    }
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
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground mb-4">No departments yet. Add your first department to get started.</p>
            <Button onClick={() => router.push("/principal/departments/new")}>
              <Plus className="h-4 w-4 mr-2" />
              Add Department
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {topLevelDepartments.map((dept) => (
            <Card
              key={dept.id}
              className={`cursor-pointer transition-colors hover:border-primary/50 ${!dept.isActive ? "opacity-60" : ""}`}
              onClick={() => router.push(`/principal/departments/${dept.id}`)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary" className="text-xs font-mono shrink-0">
                        {dept.code}
                      </Badge>
                      {!dept.isActive && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                      <FreshmanDepartmentBadge departmentId={dept.id} allDepartments={departments as DepartmentWithId[]} />
                    </div>
                    <p className="font-semibold text-sm leading-tight">{dept.name}</p>
                    {dept.hodName && dept.hodUid ? (
                      (() => {
                        const hod = hods.find((h) => h.uid === dept.hodUid);
                        const hodDepts = hod?.departments && hod.departments.length > 0 ? hod.departments : [dept.hodName ? dept.name : ""].filter(Boolean);
                        const otherDepts = hodDepts.filter((n) => n !== dept.name);
                        return (
                          <div className="mt-1.5">
                            <div className="flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                              <p className="text-xs text-muted-foreground truncate">
                                HOD: {dept.hodName}
                                {otherDepts.length > 0 && <span> · also {otherDepts.join(", ")}</span>}
                              </p>
                            </div>
                            <div onClick={(e) => e.stopPropagation()}>
                              <ManageHodDepartmentsDialog
                                hodUid={dept.hodUid}
                                hodName={dept.hodName}
                                currentDepartments={hodDepts}
                                topLevelDepartments={topLevelDepartments}
                                onSaved={() => void loadDepts()}
                              />
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <p className="text-xs text-orange-500 mt-1.5">No HOD assigned</p>
                    )}
                    {(() => {
                      const deptCourses = coursesOf(dept.id);
                      // A department with courses shows each one's OWN resolved
                      // years/cross-listing (a per-course override when set,
                      // else the flat fields below) - a department offering
                      // both B.Tech and M.Tech can have entirely different
                      // structures for each. One that hasn't added any course
                      // yet falls back to the flat fields as a general preview.
                      if (deptCourses.length > 0) {
                        return (
                          <div className="mt-1.5 space-y-1.5">
                            {deptCourses.map((c) => {
                              const scope = resolveDepartmentCourseScope(dept, c.catalogId);
                              return (
                                <div key={c.id} className="text-xs text-muted-foreground">
                                  <span className="text-foreground font-medium">{c.name}:</span>{" "}
                                  {scope.assignedYears.length > 0
                                    ? scope.assignedYears.map(yearOrdinalLabel).join(", ")
                                    : "No years assigned yet"}
                                  {scope.secondaryDepartments.length > 0 && (
                                    <DepartmentChipList names={scope.secondaryDepartments} className="mt-1" />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      }
                      return (
                        <>
                          {dept.assignedYears && dept.assignedYears.length > 0 ? (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {dept.assignedYears.map((y) => (
                                <Badge key={y} variant="outline" className="text-xs">{yearOrdinalLabel(y)}</Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground mt-1.5">No years assigned yet</p>
                          )}
                          {dept.secondaryDepartments && dept.secondaryDepartments.length > 0 && (
                            <div className="mt-1.5">
                              <p className="text-xs text-muted-foreground">Cross-listed with</p>
                              <DepartmentChipList names={dept.secondaryDepartments} className="mt-1" />
                            </div>
                          )}
                        </>
                      );
                    })()}
                    {childrenOf(dept.id).length > 0 && (
                      <div className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                        <Layers className="h-3 w-3 mt-0.5 shrink-0" />
                        <span>
                          {childrenOf(dept.id).length} sub-department
                          {childrenOf(dept.id).length !== 1 ? "s" : ""}:{" "}
                          <span className="text-foreground">
                            {childrenOf(dept.id).map((c) => c.name).join(", ")}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => { e.stopPropagation(); router.push(`/principal/departments/${dept.id}/edit`); }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); setDeletingDept(dept); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-primary mt-3">Manage courses &amp; timings →</p>
              </CardContent>
            </Card>
          ))}
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
