"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users, Pencil, Trash2, Plus, GraduationCap, UserCog, Eye, Network, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import type { SectionListItem, Course, Department } from "@/types";

type SectionRow = SectionListItem;

const YEAR_PALETTE = [
  "bg-purple-50 border-purple-200 text-purple-800",
  "bg-blue-50 border-blue-200 text-blue-800",
  "bg-emerald-50 border-emerald-200 text-emerald-800",
  "bg-amber-50 border-amber-200 text-amber-800",
  "bg-rose-50 border-rose-200 text-rose-800",
  "bg-cyan-50 border-cyan-200 text-cyan-800",
];
const YEAR_BADGE_PALETTE = [
  "bg-purple-100 text-purple-700",
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
];
function yearColor(year: number) { return YEAR_PALETTE[(year - 1) % YEAR_PALETTE.length]; }
function yearBadge(year: number) { return YEAR_BADGE_PALETTE[(year - 1) % YEAR_BADGE_PALETTE.length]; }
function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

const STUDENT_FACULTY_RATIO = 15;

export default function HODSectionsPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeCourseId, setActiveCourseId] = useState<string>("all");
  const [activeYear, setActiveYear] = useState<number | "all">("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [reassigningId, setReassigningId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<SectionRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [sectionsRes, coursesRes, deptsRes] = await Promise.all([
        fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections: SectionRow[] }>),
        fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
      ]);
      setSections(sectionsRes.sections ?? []);
      setCourses((coursesRes.courses ?? []).sort((a, b) => a.name.localeCompare(b.name)));
      setDepartments(deptsRes.departments ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load sections" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Invoked through an async wrapper so the loader's setState calls aren't
  // reachable synchronously from the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  // Own department + its sub-departments - the set a main HOD can reassign an
  // existing section between (handing it to a Sub-HOD to run, or pulling it
  // back). Empty for a Sub-HOD (their department has no children of its own),
  // so the picker below simply doesn't render for them.
  const ownDept = useMemo(() => departments.find((d) => d.name === user?.department) ?? null, [departments, user]);
  // A grouping container (e.g. "BS-Maths" grouping IT + CSE under a Sub-HOD) is
  // not a real department, so it's never a section's owner or a target here.
  const isGroupingContainer = (ownDept?.managedDepartments?.length ?? 0) > 0;
  // Real departments this HOD can assign a section to: sub-departments and
  // grouped/managed branches. A grouping container drops itself; a normal HOD
  // keeps their own department too.
  const deptOptions = useMemo(() => {
    if (!ownDept) return [];
    const children = departments.filter((d) => d.parentDepartmentId === ownDept.id);
    const managed = departments.filter((d) => (ownDept.managedDepartments ?? []).includes(d.name));
    return isGroupingContainer ? [...children, ...managed] : [ownDept, ...children, ...managed];
  }, [departments, ownDept, isGroupingContainer]);

  // The department/branch filter tabs - the real departments this (sub-)HOD
  // manages (never the grouping container), union-ed with any real department
  // already present on a loaded section so none is unreachable by a tab.
  const scopeDepartments = useMemo(() => {
    const names = new Set(deptOptions.map((d) => d.name));
    for (const s of sections) if (s.department && s.department !== ownDept?.name) names.add(s.department);
    return Array.from(names).filter(Boolean).sort();
  }, [deptOptions, sections, ownDept]);

  async function handleReassign(section: SectionRow, departmentId: string) {
    if (departmentId === deptOptions.find((d) => d.name === section.department)?.id) return;
    setReassigningId(section.id);
    try {
      const res = await fetch(`/api/college/sections/${section.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentId }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to reassign section" });
        return;
      }
      const newDeptName = deptOptions.find((d) => d.id === departmentId)?.name ?? "";
      toast({ variant: "success", title: `Section ${section.name} moved to ${newDeptName}` });
      void load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setReassigningId(null);
    }
  }

  function openCreate() {
    router.push(activeCourseId !== "all" ? `/hod/sections/new?courseId=${activeCourseId}` : "/hod/sections/new");
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/sections/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to delete" });
        return;
      }
      toast({ variant: "success", title: `Section ${deleteTarget.name} deleted` });
      setDeleteTarget(null);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setIsDeleting(false);
    }
  }

  const activeCourse = activeCourseId !== "all" ? courses.find((c) => c.id === activeCourseId) ?? null : null;

  const filteredSections = sections.filter((s) => {
    if (activeCourseId !== "all" && s.courseId !== activeCourseId) return false;
    if (activeCourse && activeYear !== "all" && s.year !== activeYear) return false;
    if (deptFilter !== "all" && s.department !== deptFilter) return false;
    return true;
  });

  // Group by course, then by year within each course
  type Group = { courseId: string; courseName: string; year: number; sections: SectionRow[] };
  const groups: Group[] = [];
  for (const s of filteredSections) {
    let g = groups.find((x) => x.courseId === s.courseId && x.year === s.year);
    if (!g) {
      g = { courseId: s.courseId, courseName: s.courseName ?? "Unknown Course", year: s.year, sections: [] };
      groups.push(g);
    }
    g.sections.push(s);
  }
  groups.sort((a, b) => a.courseName.localeCompare(b.courseName) || a.year - b.year);

  const totalStudents = sections.reduce((sum, s) => sum + (s.studentCount ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sections"
        description="Manage class sections, assign faculty incharge, and track student count"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/hod/students/import"><Upload className="h-4 w-4 mr-2" />Import Students</Link>
            </Button>
            <Button onClick={openCreate} disabled={courses.length === 0}>
              <Plus className="h-4 w-4 mr-2" />Add Section
            </Button>
          </div>
        }
      />

      {!isLoading && courses.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No courses have been set up for your department yet. Ask the Principal to add courses under Departments before creating sections.
        </div>
      )}

      {/* Summary strip */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <GraduationCap className="h-4 w-4" />
          <span><strong className="text-foreground">{sections.length}</strong> sections</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Users className="h-4 w-4" />
          <span><strong className="text-foreground">{totalStudents}</strong> students total</span>
        </div>
        {totalStudents > 0 && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <UserCog className="h-4 w-4" />
            <span>
              <strong className="text-foreground">{Math.ceil(totalStudents / STUDENT_FACULTY_RATIO)}</strong> faculty needed
              <span className="ml-1 text-xs">(1:{STUDENT_FACULTY_RATIO} ratio)</span>
            </span>
          </div>
        )}
      </div>

      {/* Course filter tabs */}
      {courses.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => { setActiveCourseId("all"); setActiveYear("all"); }}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              activeCourseId === "all"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted"
            }`}
          >
            All Courses
          </button>
          {courses.map((c) => (
            <button
              key={c.id}
              onClick={() => { setActiveCourseId(c.id); setActiveYear("all"); }}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                activeCourseId === c.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Department / branch filter tabs - own department plus every branch
          grouped under this (sub-)HOD, so a Sub-HOD can jump between the
          departments assigned to them (All, CSE, IT, ...). */}
      {scopeDepartments.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setDeptFilter("all")}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              deptFilter === "all"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted"
            }`}
          >
            All Departments
          </button>
          {scopeDepartments.map((d) => (
            <button
              key={d}
              onClick={() => setDeptFilter(d)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                deptFilter === d
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      {/* Year filter tabs (only when a specific course is selected) */}
      {activeCourse && (
        <div className="flex gap-2 flex-wrap">
          {(["all", ...Array.from({ length: activeCourse.durationYears }, (_, i) => i + 1)] as const).map((y) => (
            <button
              key={y}
              onClick={() => setActiveYear(y)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                activeYear === y
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {y === "all" ? "All Years" : ordinalYear(y)}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-40 rounded-xl border bg-muted/30 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && courses.length > 0 && sections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <GraduationCap className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="font-medium">No sections yet</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">Create your first section to get started</p>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Section</Button>
        </div>
      )}

      {/* Sections grouped by course + year */}
      {!isLoading && groups.length > 0 && (
        <div className="space-y-8">
          {groups.map((g) => {
            const sts = g.sections.reduce((s, r) => s + (r.studentCount ?? 0), 0);
            const req = sts > 0 ? Math.ceil(sts / STUDENT_FACULTY_RATIO) : 0;
            return (
              <div key={`${g.courseId}_${g.year}`}>
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="font-semibold text-base">
                    {activeCourseId === "all" ? `${g.courseName} · ${ordinalYear(g.year)}` : ordinalYear(g.year)}
                  </h2>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${yearBadge(g.year)}`}>
                    {g.sections.length} section{g.sections.length !== 1 ? "s" : ""} · {sts} students
                    {req > 0 && <span className="ml-1 opacity-75">· {req} faculty needed</span>}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {g.sections.map((sec) => (
                    <div
                      key={sec.id}
                      className={`rounded-xl border-2 p-5 flex flex-col gap-3 ${yearColor(sec.year)}`}
                    >
                      {/* Header row */}
                      <div className="flex items-start justify-between">
                        <Link href={`/hod/sections/${sec.id}`} className="hover:underline">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-2xl font-bold tracking-tight">Section {sec.name}</p>
                            {/* The section's own department (branch) - always shown so a
                                Sub-HOD can tell which of their managed branches it belongs to. */}
                            {sec.department && (
                              <Badge variant="secondary" className="text-xs">{sec.department}</Badge>
                            )}
                            {sec.secondaryDepartments && sec.secondaryDepartments.length > 0 && (
                              <Badge variant="outline" className="text-xs">+ {sec.secondaryDepartments.join(", ")}</Badge>
                            )}
                            {sec.accessLevel === "secondary" && (
                              <Badge variant="secondary" className="text-xs">View only</Badge>
                            )}
                          </div>
                          <p className="text-sm opacity-70 mt-0.5">{sec.batch}</p>
                        </Link>
                        <div className="flex gap-1">
                          <button
                            onClick={() => router.push(`/hod/sections/${sec.id}`)}
                            className="p-1.5 rounded-md hover:bg-black/10 transition-colors"
                            title="View students"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          {sec.accessLevel !== "secondary" && (
                            <>
                              <button
                                onClick={() => router.push(`/hod/sections/${sec.id}/edit`)}
                                className="p-1.5 rounded-md hover:bg-black/10 transition-colors"
                                title="Edit section"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleteTarget(sec)}
                                className="p-1.5 rounded-md hover:bg-red-200/60 transition-colors text-red-700"
                                title="Delete section"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Department reassignment - only for a MAIN HOD whose department
                          has sub-departments, to hand a section to a Sub-HOD (or pull it
                          back). Hidden for a Sub-HOD: their sections already carry the
                          real branch they created them under, so the picker was just
                          noise. The section's department is shown as a badge above. */}
                      {deptOptions.length > 1 && !isGroupingContainer && sec.accessLevel !== "secondary" && (
                        <div className="flex items-center gap-2">
                          <Network className="h-4 w-4 opacity-50 shrink-0" />
                          <Select
                            value={deptOptions.find((d) => d.name === sec.department)?.id ?? ""}
                            onValueChange={(v) => void handleReassign(sec, v)}
                            disabled={reassigningId === sec.id}
                          >
                            <SelectTrigger className="h-8 text-sm bg-background/60">
                              <SelectValue placeholder="Department" />
                            </SelectTrigger>
                            <SelectContent>
                              {deptOptions.map((d) => (
                                <SelectItem key={d.id} value={d.id}>
                                  {d.id === ownDept?.id ? `${d.name} (yours)` : d.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {/* Faculty incharge */}
                      <div className="flex items-center gap-2">
                        <UserCog className="h-4 w-4 opacity-50 shrink-0" />
                        <span className="text-sm">
                          {sec.facultyInchargeName
                            ? <strong>{sec.facultyInchargeName}</strong>
                            : <span className="opacity-50 italic">No incharge assigned</span>
                          }
                        </span>
                      </div>

                      {/* Student intake + faculty ratio */}
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 opacity-50 shrink-0" />
                        <span className="text-sm">
                          <strong>{sec.studentCount ?? 0}</strong> students
                        </span>
                      </div>
                      {(sec.studentCount ?? 0) > 0 && (
                        <div className="flex items-center gap-2 mt-0.5">
                          <GraduationCap className="h-4 w-4 opacity-50 shrink-0" />
                          <span className="text-sm">
                            <strong>{Math.ceil((sec.studentCount ?? 0) / STUDENT_FACULTY_RATIO)}</strong> faculty needed
                            <span className="text-[11px] opacity-60 ml-1">(1:{STUDENT_FACULTY_RATIO})</span>
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Delete Confirm ── */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={`Delete Section ${deleteTarget?.name ?? ""}?`}
        description={
          (deleteTarget?.studentCount ?? 0) > 0
            ? `This section has ${deleteTarget?.studentCount} student(s). Remove all students before deleting.`
            : `This will permanently delete Section ${deleteTarget?.name ?? ""} (${deleteTarget?.batch ?? ""}). This cannot be undone.`
        }
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />
    </div>
  );
}
