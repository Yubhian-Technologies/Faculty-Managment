"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Pencil, Trash2, Clock, GraduationCap, CheckCircle2, CalendarClock, Layers, SlidersHorizontal, GitBranch, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { YearsTaughtAndSecondaryFields } from "@/components/college/YearsTaughtAndSecondaryFields";
import { FreshmanDepartmentBadge } from "@/components/shared/FreshmanDepartmentBadge";
import { DepartmentChipList } from "@/components/shared/DepartmentChipList";
import { resolveDepartmentCourseScope, type DepartmentWithId } from "@/lib/college/academicStructure";
import { toast } from "@/hooks/useToast";
import type { Department, Course, CourseYearTiming, CourseAcademicYear } from "@/types";

export default function DepartmentDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [department, setDepartment] = useState<Department | null>(null);
  // Every department in the college - the Edit Academic Structure dialog's
  // Secondary Departments picker needs the full list, same options the flat
  // Edit Department page computes.
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  // Sub-departments of this one, plus its parent when this IS a sub-department -
  // both come free from the departments list already fetched below.
  const [subDepartments, setSubDepartments] = useState<Department[]>([]);
  const [parentDepartment, setParentDepartment] = useState<Department | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  // Only populated on a sub-department page: everything the parent offers,
  // used to list the courses this department has removed from its own view so
  // they can be put back. Empty everywhere else.
  const [parentCourses, setParentCourses] = useState<Course[]>([]);
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);
  const [academicYears, setAcademicYears] = useState<CourseAcademicYear[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null);

  // Per-course "Edit Academic Structure" dialog - null when closed. Every
  // course now has its own explicit courseScopes override (set mandatorily at
  // creation - see courses/new), so this always edits that override directly
  // rather than offering an on/off "custom vs. department default" toggle.
  const [structureTarget, setStructureTarget] = useState<Course | null>(null);
  const [structureAssignedYears, setStructureAssignedYears] = useState<number[]>([]);
  const [isSavingStructure, setIsSavingStructure] = useState(false);

  // A sub-department (one with a parent) shows its parent's courses by
  // default, but can diverge from them: customise one into its own independent
  // copy, remove one it doesn't run, or add a course only it offers. What it
  // must never do is edit or delete the PARENT's Course doc, which every
  // sibling shares - so the actions on an inherited course differ from those on
  // one this department owns. See lib/departments/subDepartmentCourses.ts.
  const isSubDepartment = !!parentDepartment;

  // An inherited course the sub-department is about to make its own, and one
  // it's about to remove from its own list - both null when no dialog is open.
  const [customisingCourse, setCustomisingCourse] = useState<Course | null>(null);
  const [isCustomising, setIsCustomising] = useState(false);
  const [removingInherited, setRemovingInherited] = useState<Course | null>(null);

  /** True when this row is this department's own Course doc rather than the parent's. */
  const isOwnCourse = useCallback(
    (course: Course) => course.departmentId === id,
    [id]
  );

  // The parent's courses this sub-department has removed from its own list -
  // the ones the courses API deliberately filters out, recovered from the
  // parent's own list so they can still be restored. A course it has since
  // customised is not "removed" however stale the exclusion looks, matching
  // resolveSubDepartmentCourses' own precedence.
  const removedCourses = useMemo(() => {
    const excluded = new Set(department?.excludedCourseCatalogIds ?? []);
    if (excluded.size === 0) return [];
    const ownCatalogIds = new Set(
      courses.filter(isOwnCourse).map((c) => c.catalogId).filter((v): v is string => !!v)
    );
    return parentCourses
      .filter((c) => c.catalogId && excluded.has(c.catalogId) && !ownCatalogIds.has(c.catalogId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [department, parentCourses, courses, isOwnCourse]);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [deptRes, coursesRes] = await Promise.all([
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
        fetch(`/api/college/courses?departmentId=${encodeURIComponent(id)}`).then((r) => r.json() as Promise<{ courses: Course[] }>),
      ]);
      const allDepts = deptRes.departments ?? [];
      const dept = allDepts.find((d) => d.id === id) ?? null;
      setDepartment(dept);
      setAllDepartments(allDepts);
      setSubDepartments(
        allDepts
          .filter((d) => d.parentDepartmentId === id)
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setParentDepartment(
        dept?.parentDepartmentId
          ? allDepts.find((d) => d.id === dept.parentDepartmentId) ?? null
          : null
      );
      // The courses API also merges in a *feeder's* courses (a department that
      // cross-lists this one via secondaryDepartments, e.g. Basic Science
      // feeding AIDS for the shared first year) - useful for an HOD picker
      // borrowing a course it doesn't own, but wrong here: Add/Edit/Delete on
      // this page only ever act on THIS department's own Course docs, so a
      // feeder's course rendered alongside would show as a confusing duplicate
      // and could be edited/deleted from the wrong department's page. A real
      // sub-department (parentDepartmentId set) is the one case that's
      // supposed to show it: the API has already settled its list against its
      // parent's (filterSubDepartmentCourses - removals dropped, its own
      // customised copies standing in), so everything that comes back is
      // either the parent's to inherit or this department's own, and the card
      // tells the two apart by departmentId rather than by filtering here.
      const isSubDept = !!dept?.parentDepartmentId;
      const sortedCourses = (coursesRes.courses ?? [])
        .filter((c) => isSubDept || c.departmentId === id)
        .sort((a, b) => a.name.localeCompare(b.name));
      setCourses(sortedCourses);

      // A course this sub-department has removed is filtered out of its own
      // list by the API (that's the point), so the parent's full list is
      // fetched alongside purely to render those rows back as "Removed here"
      // with a way to restore them. Without it a removal would be a one-way
      // door with nothing left on screen to undo.
      if (isSubDept && dept?.parentDepartmentId) {
        const parentRes = await fetch(
          `/api/college/courses?departmentId=${encodeURIComponent(dept.parentDepartmentId)}`
        ).then((r) => r.json() as Promise<{ courses: Course[] }>);
        setParentCourses(parentRes.courses ?? []);
      } else {
        setParentCourses([]);
      }

      const [timingLists, academicYearLists] = await Promise.all([
        Promise.all(
          sortedCourses.map((c) =>
            fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(c.id)}`)
              .then((r) => r.json() as Promise<{ timings: CourseYearTiming[] }>)
              .then((d) => d.timings ?? [])
          )
        ),
        Promise.all(
          sortedCourses.map((c) =>
            fetch(`/api/college/course-academic-years?courseId=${encodeURIComponent(c.id)}`)
              .then((r) => r.json() as Promise<{ academicYears: CourseAcademicYear[] }>)
              .then((d) => d.academicYears ?? [])
          )
        ),
      ]);
      setTimings(timingLists.flat());
      setAcademicYears(academicYearLists.flat());
    } catch {
      toast({ variant: "destructive", title: "Failed to load department" });
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  // Awaited in a wrapper so load()'s setState calls aren't reachable
  // synchronously from the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  function getTiming(courseId: string, year: number): CourseYearTiming | undefined {
    return timings.find((t) => t.courseId === courseId && t.year === year);
  }

  function getAcademicYear(courseId: string, year: number): CourseAcademicYear | undefined {
    return academicYears.find((a) => a.courseId === courseId && a.year === year);
  }

  // The department's resolved academic-structure scope for one course - own
  // override/flat fields, falling back to the parent's when this department
  // has none of its own (mirrors the sub-department inheritance the "years"
  // rendering below has always done).
  function scopeForCourse(course: Course) {
    const own = department
      ? resolveDepartmentCourseScope(department, course.catalogId)
      : { assignedYears: [], secondaryDepartments: [] };
    if (own.assignedYears.length > 0 || !parentDepartment) return own;
    return resolveDepartmentCourseScope(parentDepartment, course.catalogId);
  }

  function openStructureEditor(course: Course) {
    const scope = scopeForCourse(course);
    setStructureTarget(course);
    setStructureAssignedYears(scope.assignedYears);
  }

  function toggleStructureYear(year: number, checked: boolean) {
    setStructureAssignedYears((prev) => (checked ? [...prev, year].sort((a, b) => a - b) : prev.filter((y) => y !== year)));
  }

  async function handleSaveStructure() {
    if (!department || !structureTarget?.catalogId) return;
    if (structureAssignedYears.length === 0) {
      toast({ variant: "destructive", title: "Select at least one year this department teaches this course" });
      return;
    }
    setIsSavingStructure(true);
    try {
      const body = {
        deptId: department.id,
        // Secondary Departments is NOT sent - the server always derives it
        // from this department's own flat secondaryDepartments field.
        courseScope: {
          catalogId: structureTarget.catalogId,
          assignedYears: structureAssignedYears,
        },
      };
      const res = await fetch("/api/college/departments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed to save");
      }
      toast({ variant: "success", title: `${structureTarget.name} academic structure updated` });
      setStructureTarget(null);
      await load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setIsSavingStructure(false);
    }
  }

  // Turn an inherited course into this sub-department's own independent copy.
  // The server creates a Course doc owned by this department for the same
  // catalog programme and copies the parent's current timings and academic
  // years onto it, so the department carries on from what it already had
  // rather than an empty schedule. From here the two diverge: edits on either
  // side stop affecting the other.
  async function handleCustomiseCourse() {
    if (!customisingCourse?.catalogId || !department) return;
    setIsCustomising(true);
    try {
      const res = await fetch("/api/college/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: department.id,
          catalogId: customisingCourse.catalogId,
          copyFromCourseId: customisingCourse.id,
          // The years this department already ran the shared course for, so
          // the copy starts identical rather than asking again.
          courseScope: { assignedYears: scopeForCourse(customisingCourse).assignedYears },
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to customise course");
      toast({
        variant: "success",
        title: `${customisingCourse.name} is now managed by ${department.name}`,
        description: `${parentDepartment?.name}'s copy is unchanged.`,
      });
      setCustomisingCourse(null);
      await load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to customise course" });
    } finally {
      setIsCustomising(false);
    }
  }

  // Remove an inherited course from THIS sub-department only, or put it back.
  // Recorded against this department (excludedCourseCatalogIds) - the parent's
  // Course doc is never touched, so its other children keep the course.
  async function setInheritedCourseExcluded(course: Course, excluded: boolean) {
    if (!course.catalogId || !department) return;
    try {
      const res = await fetch("/api/college/departments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deptId: department.id,
          courseExclusion: { catalogId: course.catalogId, excluded },
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to update");
      toast({
        variant: "success",
        title: excluded
          ? `${course.name} removed from ${department.name}`
          : `${course.name} restored to ${department.name}`,
        description: excluded ? `${parentDepartment?.name} still offers it.` : undefined,
      });
      setRemovingInherited(null);
      await load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to update" });
    }
  }

  async function handleDeleteCourse() {
    if (!deletingCourse) return;
    try {
      const res = await fetch(`/api/college/courses/${deletingCourse.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to delete course");
      toast({ variant: "success", title: `${deletingCourse.name} removed` });
      await load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to delete course" });
    } finally {
      setDeletingCourse(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={department?.name ?? "Department"}
        description={
          department
            ? `${department.code}${parentDepartment ? ` · Sub-department of ${parentDepartment.name}` : ""} · Manage courses and their timings`
            : "Loading…"
        }
        actions={
          <Button
            variant="outline"
            onClick={() =>
              router.push(
                // From a sub-department, "back" means its parent, not the top list.
                parentDepartment
                  ? `/principal/departments/${parentDepartment.id}`
                  : "/principal/departments"
              )
            }
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            {parentDepartment ? `Back to ${parentDepartment.name}` : "Back to Departments"}
          </Button>
        }
      />

      {department && (
        <FreshmanDepartmentBadge
          departmentId={department.id}
          allDepartments={allDepartments as DepartmentWithId[]}
          className="-mt-4"
        />
      )}

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : (
        <>
        {subDepartments.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-4 w-4" />Sub-Departments
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {subDepartments.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => router.push(`/principal/departments/${sub.id}`)}
                    className="rounded-lg border p-3 text-left transition-colors hover:border-primary/50"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary" className="text-xs font-mono shrink-0">{sub.code}</Badge>
                      {!sub.isActive && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                    </div>
                    <p className="font-semibold text-sm leading-tight">{sub.name}</p>
                    {sub.hodName ? (
                      <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                        HOD: {sub.hodName}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-xs text-orange-500">No HOD assigned</p>
                    )}
                    {/* Which real branches (e.g. IT, CSBS) this sub-department's
                        Sub-HOD fully manages - set on the HOD's own
                        Sub-Departments settings page, shown here read-only so
                        the Principal doesn't have to open each sub-department
                        just to see who's grouped where. */}
                    {sub.managedDepartments && sub.managedDepartments.length > 0 && (
                      <div className="mt-1.5">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Core Departments</p>
                        <DepartmentChipList names={sub.managedDepartments} className="mt-1" />
                      </div>
                    )}
                    <p className="mt-2 text-xs text-primary">Open &amp; add courses →</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <GraduationCap className="h-4 w-4" />Courses
            </CardTitle>
            {/* On a sub-department this adds a course only IT runs - the same
                Add flow, filed against this department rather than the parent,
                so the parent and its other children are unaffected. */}
            <Button size="sm" onClick={() => router.push(`/principal/departments/${id}/courses/new`)}>
              <Plus className="h-4 w-4 mr-2" />Add Course
            </Button>
          </CardHeader>
          <CardContent>
            {isSubDepartment && courses.length > 0 && (
              <div className="mb-3 flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <Layers className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Courses marked <span className="text-foreground">Shared</span> come from{" "}
                  <span className="text-foreground">{parentDepartment?.name}</span> and follow it. Customise one to
                  manage it here independently, or remove it if this sub-department doesn&apos;t run it - either way{" "}
                  <span className="text-foreground">{parentDepartment?.name}</span> and its other sub-departments are
                  unaffected.
                </span>
              </div>
            )}
            {courses.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {isSubDepartment
                  ? `No courses yet. Add them on ${parentDepartment?.name ?? "the parent department"} - this sub-department shares them.`
                  : "No courses yet. Add the courses offered by this department."}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {courses.map((c) => {
                  // Only surface the years this department is actually assigned
                  // to teach THIS course (resolveDepartmentCourseScope - a
                  // per-course override when one exists, else the department's
                  // flat "Years Taught"). A department set to [2,3,4] shouldn't
                  // show a Year-1 timing/academic-year row it can never use.
                  // When no years are assigned yet, fall back to the full
                  // course span so the department isn't left with nothing to
                  // configure. A sub-department inherits its parent's resolved
                  // scope before that fallback applies - see scopeForCourse.
                  const allYears = Array.from({ length: c.durationYears }, (_, i) => i + 1);
                  const scope = scopeForCourse(c);
                  // The parent's Course doc, shown here but owned elsewhere.
                  // Its timings and academic years are keyed by ITS courseId,
                  // so opening those editors from here would edit the parent's
                  // schedule for every sibling - customise it first.
                  const inherited = isSubDepartment && !isOwnCourse(c);
                  const years = scope.assignedYears.length > 0
                    ? allYears.filter((y) => scope.assignedYears.includes(y))
                    : allYears;
                  return (
                    <div key={c.id} className="rounded-lg border p-3 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-1 mb-1">
                            <Badge variant="secondary" className="text-xs font-mono">{c.code}</Badge>
                            {/* Which of the two kinds of row this is - the
                                whole point of the sub-department view, and
                                what decides the actions available above. */}
                            {isSubDepartment && (
                              <Badge variant="outline" className="text-[10px] font-normal">
                                {isOwnCourse(c) ? `Managed by ${department?.name}` : `Shared from ${parentDepartment?.name}`}
                              </Badge>
                            )}
                          </div>
                          <p className="font-semibold text-sm">{c.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{c.durationYears} year{c.durationYears !== 1 ? "s" : ""}</p>
                          {/* The programme's own length stays above - a B.Tech
                              is 4 years wherever it appears. This says which
                              slice of it THIS department runs, which is the part
                              that differs between a shared first-year parent and
                              the branches that continue the course. */}
                          {years.length > 0 && years.length < c.durationYears && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Runs year{years.length !== 1 ? "s" : ""} {years.join(", ")} here
                            </p>
                          )}
                          {scope.secondaryDepartments.length > 0 && (
                            <div className="mt-1">
                              <p className="text-xs text-muted-foreground">Cross-listed with</p>
                              <DepartmentChipList names={scope.secondaryDepartments} className="mt-1" />
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {/* Years Taught is this department's own either way -
                              a sub-department's courseScopes entry already
                              takes precedence over its parent's (scopeForCourse),
                              so this needs no copy of the course to act on. */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={!c.catalogId}
                            title={c.catalogId ? "Edit academic structure" : "This course predates the catalog system and can't have its own academic structure"}
                            onClick={() => openStructureEditor(c)}
                          >
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                          </Button>
                          {/* Editing or deleting an inherited course would hit
                              the PARENT's doc and every sibling with it, so on
                              those rows these become "make it mine" and
                              "remove it from my list" instead. */}
                          {isSubDepartment && !isOwnCourse(c) ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={!c.catalogId}
                                title={c.catalogId ? `Manage this course in ${department?.name} independently` : "This course predates the catalog system and can't be customised"}
                                onClick={() => setCustomisingCourse(c)}
                              >
                                <GitBranch className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive"
                                disabled={!c.catalogId}
                                title={c.catalogId ? `Remove from ${department?.name} only` : "This course predates the catalog system and can't be removed here"}
                                onClick={() => setRemovingInherited(c)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit course" onClick={() => router.push(`/principal/departments/${id}/courses/${c.id}/edit`)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Delete course" onClick={() => setDeletingCourse(c)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1.5 border-t pt-2">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Year Timings</p>
                        {years.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No years assigned to this department yet.</p>
                        ) : years.map((y) => {
                          const t = getTiming(c.id, y);
                          const ay = getAcademicYear(c.id, y);
                          return (
                            <div
                              key={y}
                              onClick={inherited ? undefined : () => router.push(`/principal/departments/${id}/courses/${c.id}/timing/${y}/edit`)}
                              className={`flex w-full flex-col gap-1 rounded-md border px-2 py-1.5 text-xs ${inherited ? "" : "hover:bg-muted/50 transition-colors cursor-pointer"}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-1.5 font-medium">
                                  <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                                  Year {y}
                                </span>
                                {t ? (
                                  <span className="flex items-center gap-1 text-emerald-600 font-medium">
                                    <CheckCircle2 className="h-3 w-3" />
                                    {t.collegeStartTime}–{t.collegeEndTime} · {t.numberOfPeriods} periods
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">{isSubDepartment ? "Not configured" : "Not configured - tap to add"}</span>
                                )}
                              </div>
                              <span
                                onClick={inherited ? undefined : (e) => {
                                  e.stopPropagation();
                                  router.push(`/principal/departments/${id}/courses/${c.id}/academic-year/${y}/edit`);
                                }}
                                className={`flex items-center gap-1.5 self-start ${isSubDepartment ? "" : "hover:underline"}`}
                              >
                                <CalendarClock className="h-3 w-3 shrink-0" />
                                {ay ? (
                                  <span className="text-emerald-600 font-medium">{ay.label}{isSubDepartment ? "" : " - tap to advance"}</span>
                                ) : (
                                  <span className="text-orange-500 font-medium">{isSubDepartment ? "Academic year not set" : "Academic year required - tap to set"}</span>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Courses the parent offers that this sub-department has taken
                off its own list. Kept visible (and restorable) rather than
                vanishing - otherwise a removal is a one-way door with nothing
                on screen to undo it. */}
            {isSubDepartment && removedCourses.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Not offered by {department?.name}
                </p>
                <div className="space-y-2">
                  {removedCourses.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="outline" className="text-xs font-mono shrink-0">{c.code}</Badge>
                        <span className="text-sm text-muted-foreground truncate">{c.name}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 text-xs"
                        onClick={() => void setInheritedCourseExcluded(c, false)}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" />Restore
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        </>
      )}

      <ConfirmDialog
        open={!!customisingCourse}
        onOpenChange={(open) => !open && setCustomisingCourse(null)}
        title={`Manage ${customisingCourse?.name ?? "this course"} in ${department?.name ?? "this sub-department"}?`}
        description={`${department?.name} gets its own copy of this course, with ${parentDepartment?.name}'s current timings and academic years copied across. From then on the two are independent - changes here won't follow ${parentDepartment?.name}, and its other sub-departments keep sharing the original.`}
        confirmLabel={isCustomising ? "Setting up..." : "Manage here"}
        onConfirm={() => void handleCustomiseCourse()}
      />

      <ConfirmDialog
        open={!!removingInherited}
        onOpenChange={(open) => !open && setRemovingInherited(null)}
        title={`Remove ${removingInherited?.name ?? "this course"} from ${department?.name ?? "this sub-department"}?`}
        description={`${department?.name} will no longer offer this course. ${parentDepartment?.name} and its other sub-departments are unaffected, and you can restore it here at any time.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => {
          if (removingInherited) void setInheritedCourseExcluded(removingInherited, true);
        }}
      />

      <ConfirmDialog
        open={!!deletingCourse}
        onOpenChange={(open) => !open && setDeletingCourse(null)}
        title={`Delete ${deletingCourse?.name ?? "course"}?`}
        // Deleting a sub-department's own customised copy doesn't remove the
        // course from it - the parent still offers it, so it goes back to
        // being shared, along with the parent's timings. Saying "permanently
        // remove" there would describe the wrong outcome. (Use Remove instead
        // to stop offering it at all.)
        description={
          isSubDepartment && deletingCourse && isOwnCourse(deletingCourse) && parentCourses.some((p) => p.catalogId && p.catalogId === deletingCourse.catalogId)
            ? `${department?.name}'s own copy is deleted and this course goes back to following ${parentDepartment?.name}, including its timings. Courses with existing sections cannot be deleted.`
            : "This will permanently remove the course. Courses with existing sections cannot be deleted."
        }
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDeleteCourse()}
      />

      <Dialog open={!!structureTarget} onOpenChange={(open) => !open && setStructureTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{structureTarget?.name} - Academic Structure</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <YearsTaughtAndSecondaryFields
              assignedYears={structureAssignedYears}
              onToggleYear={toggleStructureYear}
              maxYear={structureTarget?.durationYears}
              yearsHelperText={`Which years of this ${structureTarget?.durationYears ?? ""}-year course ${department?.name ?? "this department"} teaches. HODs can only create sections for these years.`}
              secondaryDepartmentOptions={allDepartments.filter((d) => d.id !== department?.id && d.parentDepartmentId !== department?.id)}
              secondaryDepartments={department?.secondaryDepartments ?? []}
              onToggleSecondaryDepartment={() => {}}
              showSecondaryDepartments={false}
              secondaryDepartmentsNote={
                (department?.secondaryDepartments?.length ?? 0) > 0
                  ? `Cross-listed with ${department!.secondaryDepartments!.join(", ")} - set on ${department?.name ?? "this department"}'s own page, not per course.`
                  : `${department?.name ?? "This department"} has no Core Departments set - edit the department to cross-list it to others.`
              }
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setStructureTarget(null)}>Cancel</Button>
            <Button onClick={() => void handleSaveStructure()} loading={isSavingStructure} disabled={structureAssignedYears.length === 0}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
