"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Pencil, Trash2, Clock, GraduationCap, CheckCircle2, CalendarClock, Layers } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import type { Department, Course, CourseYearTiming, CourseAcademicYear } from "@/types";

export default function DepartmentDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [department, setDepartment] = useState<Department | null>(null);
  // Sub-departments of this one, plus its parent when this IS a sub-department -
  // both come free from the departments list already fetched below.
  const [subDepartments, setSubDepartments] = useState<Department[]>([]);
  const [parentDepartment, setParentDepartment] = useState<Department | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);
  const [academicYears, setAcademicYears] = useState<CourseAcademicYear[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null);

  // A sub-department (one with a parent) shares its parent's courses/timings/
  // academic years rather than owning any - so its detail view is read-only for
  // those, to stop a course edit/delete here from mutating the parent's.
  const isSubDepartment = !!parentDepartment;

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
      const sortedCourses = (coursesRes.courses ?? []).sort((a, b) => a.name.localeCompare(b.name));
      setCourses(sortedCourses);

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
            {/* A sub-department shares its parent's program - it never owns
                courses of its own (courses resolve to the parent, see
                getRelatedDepartmentIds). So course creation and edits stay on
                the parent's page; here they'd delete/edit the parent's course. */}
            {!isSubDepartment && (
              <Button size="sm" onClick={() => router.push(`/principal/departments/${id}/courses/new`)}>
                <Plus className="h-4 w-4 mr-2" />Add Course
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {isSubDepartment && courses.length > 0 && (
              <div className="mb-3 flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <Layers className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  These courses, timings and academic years belong to{" "}
                  <span className="text-foreground">{parentDepartment?.name}</span> and are shared by this
                  sub-department. Manage them from the parent department.
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
                  // to teach (Department.assignedYears - the "Years Taught"
                  // selection). A department set to [2,3,4] shouldn't show a
                  // Year-1 timing/academic-year row it can never use. When no
                  // years are assigned yet, fall back to the full course span so
                  // the department isn't left with nothing to configure.
                  //
                  // A sub-department inherits its parent's years before that
                  // fallback applies. It borrows the parent's course rather than
                  // owning one (see getRelatedDepartmentIds), so it runs that
                  // course over the parent's span, not the catalogue's full
                  // duration - and it can never have years of its own to state,
                  // because college/departments POST strips assignedYears from
                  // anything an HOD creates (years are Principal territory).
                  // Without this a shared first-year department's children each
                  // advertised all 4 years of a B.Tech the parent runs year 1 of.
                  // Same own-then-parent fallback the HOD sections pages use.
                  const allYears = Array.from({ length: c.durationYears }, (_, i) => i + 1);
                  const ownYears = department?.assignedYears ?? [];
                  const assigned = ownYears.length > 0 ? ownYears : parentDepartment?.assignedYears ?? [];
                  const years = assigned.length > 0 ? allYears.filter((y) => assigned.includes(y)) : allYears;
                  return (
                    <div key={c.id} className="rounded-lg border p-3 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <Badge variant="secondary" className="text-xs font-mono mb-1">{c.code}</Badge>
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
                        </div>
                        {!isSubDepartment && (
                          <div className="flex gap-1 shrink-0">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => router.push(`/principal/departments/${id}/courses/${c.id}/edit`)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeletingCourse(c)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
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
                              onClick={isSubDepartment ? undefined : () => router.push(`/principal/departments/${id}/courses/${c.id}/timing/${y}/edit`)}
                              className={`flex w-full flex-col gap-1 rounded-md border px-2 py-1.5 text-xs ${isSubDepartment ? "" : "hover:bg-muted/50 transition-colors cursor-pointer"}`}
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
                                onClick={isSubDepartment ? undefined : (e) => {
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
          </CardContent>
        </Card>
        </>
      )}

      <ConfirmDialog
        open={!!deletingCourse}
        onOpenChange={(open) => !open && setDeletingCourse(null)}
        title={`Delete ${deletingCourse?.name ?? "course"}?`}
        description="This will permanently remove the course. Courses with existing sections cannot be deleted."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDeleteCourse()}
      />
    </div>
  );
}
