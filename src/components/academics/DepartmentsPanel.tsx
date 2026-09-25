"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, CheckCircle2, Upload, Layers, ArrowLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FreshmanDepartmentBadge } from "@/components/shared/FreshmanDepartmentBadge";
import { DepartmentChipList } from "@/components/shared/DepartmentChipList";
import { toast } from "@/hooks/useToast";
import { yearOrdinalLabel } from "@/lib/college/academicYears";
import { resolveDepartmentCourseScope, replaceNoOwnSectionsParents, type DepartmentWithId } from "@/lib/college/academicStructure";
import { RoleAssignmentsPage } from "@/components/roles/RoleAssignmentsPage";
import { SectionCard } from "@/components/academics/SectionsPanel";
import { SectionRoster } from "@/components/academics/SectionRoster";
import type { Course, Department, Section } from "@/types";

type DeptWithMaybeId = Department & { id: string };

function sectionsOfDepartment(dept: DeptWithMaybeId, sections: Section[]) {
  return sections.filter((s) => {
    const sid = (s as Section & { departmentId?: string }).departmentId;
    return sid ? sid === dept.id : s.department === dept.name || s.department === dept.code;
  });
}

// In-place drill-down for one top-level department: sub-departments (if it has
// any) -> that sub-department's sections -> a section's student roster. All of
// it renders inside the Departments toggle - nothing navigates away.
function DepartmentDrillDown({ departments, rootId, onExit }: {
  departments: Department[];
  rootId: string;
  onExit: () => void;
}) {
  const [path, setPath] = useState<string[]>([rootId]);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
  const deptSections = useMemo(
    () => (current && children.length === 0 ? sectionsOfDepartment(current as DeptWithMaybeId, sections) : []),
    [current, sections, children.length]
  );
  const byYear = useMemo(() => {
    const map = new Map<number, Section[]>();
    for (const s of deptSections) map.set(s.year, [...(map.get(s.year) ?? []), s]);
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [deptSections]);

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
          <Button variant="outline" size="sm" onClick={goBack}>
            <ArrowLeft className="h-4 w-4 mr-1" />Back
          </Button>
        </div>
      </div>

      <PageHeader
        title={current.name}
        description={children.length > 0 ? "Select a sub-department to see its sections" : "Select a section to see its students"}
      />

      {children.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {children.map((c) => (
            <Card key={c.id} className="cursor-pointer transition-colors hover:border-primary/50" onClick={() => setPath([...path, c.id])}>
              <CardContent className="p-4">
                <Badge variant="secondary" className="text-xs font-mono mb-1">{c.code}</Badge>
                <p className="font-semibold text-sm leading-tight">{c.name}</p>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {c.hodName ? `HOD: ${c.hodName}` : "No HOD assigned"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : byYear.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No sections in this department yet.</CardContent></Card>
      ) : (
        <div className="space-y-8">
          {byYear.map(([year, list]) => (
            <div key={year}>
              <h2 className="font-semibold text-base mb-3">{yearOrdinalLabel(year)}</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((sec) => <SectionCard key={sec.id} sec={sec} onOpen={() => setOpenSectionId(sec.id)} />)}
              </div>
            </div>
          ))}
        </div>
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
  // Cross-listing chips are shown narrowed (replaceNoOwnSectionsParents): a
  // department that organises its sub-departments and runs no sections of its
  // own is never a real destination, so it reads here as those children - the
  // same substitution every picker and every section/student write path makes.
  // Purely presentational; the stored value is untouched until the Principal
  // saves the department again.
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
    return <DepartmentDrillDown departments={departments} rootId={selectedDeptId} onExit={() => setSelectedDeptId(null)} />;
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {topLevelDepartments.map((dept) => (
            <Card
              key={dept.id}
              className={`cursor-pointer transition-colors hover:border-primary/50 ${!dept.isActive ? "opacity-60" : ""}`}
              onClick={() => setSelectedDeptId(dept.id)}
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
                    <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                      {dept.hodName && dept.hodUid ? (
                        <div className="flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                          <p className="text-xs text-muted-foreground truncate">HOD: {dept.hodName}</p>
                        </div>
                      ) : (
                        <p className="text-xs text-orange-500">No HOD assigned</p>
                      )}
                    </div>
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
                                    <DepartmentChipList
                                      names={replaceNoOwnSectionsParents(departments as DepartmentWithId[], scope.secondaryDepartments)}
                                      className="mt-1"
                                    />
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
                              <DepartmentChipList
                                names={replaceNoOwnSectionsParents(departments as DepartmentWithId[], dept.secondaryDepartments)}
                                className="mt-1"
                              />
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
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); router.push(`/principal/departments/${dept.id}/edit`); }}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); setDeletingDept(dept); }}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Delete
                    </Button>
                  </div>
                </div>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="mt-3 h-8 w-full text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Link href={`/principal/departments/${dept.id}`}>Manage courses &amp; timings →</Link>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 h-8 w-full text-xs"
                  onClick={(e) => { e.stopPropagation(); setShowRoles(true); }}
                >
                  Change in Role Assignments
                </Button>
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
