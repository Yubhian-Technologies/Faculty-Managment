"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Pencil, Trash2, Clock, GraduationCap, CheckCircle2, CalendarClock } from "lucide-react";
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
  const [courses, setCourses] = useState<Course[]>([]);
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);
  const [academicYears, setAcademicYears] = useState<CourseAcademicYear[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [deptRes, coursesRes] = await Promise.all([
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
        fetch(`/api/college/courses?departmentId=${encodeURIComponent(id)}`).then((r) => r.json() as Promise<{ courses: Course[] }>),
      ]);
      const dept = (deptRes.departments ?? []).find((d) => d.id === id) ?? null;
      setDepartment(dept);
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

  useEffect(() => { void load(); }, [load]);

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
        description={department ? `${department.code} · Manage courses and their timings` : "Loading…"}
        actions={
          <Button variant="outline" onClick={() => router.push("/principal/departments")}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back to Departments
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <GraduationCap className="h-4 w-4" />Courses
            </CardTitle>
            <Button size="sm" onClick={() => router.push(`/principal/departments/${id}/courses/new`)}>
              <Plus className="h-4 w-4 mr-2" />Add Course
            </Button>
          </CardHeader>
          <CardContent>
            {courses.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No courses yet. Add the courses offered by this department.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {courses.map((c) => {
                  const years = Array.from({ length: c.durationYears }, (_, i) => i + 1);
                  return (
                    <div key={c.id} className="rounded-lg border p-3 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <Badge variant="secondary" className="text-xs font-mono mb-1">{c.code}</Badge>
                          <p className="font-semibold text-sm">{c.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{c.durationYears} year{c.durationYears !== 1 ? "s" : ""}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => router.push(`/principal/departments/${id}/courses/${c.id}/edit`)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeletingCourse(c)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-1.5 border-t pt-2">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Timings by Year</p>
                        {years.map((y) => {
                          const t = getTiming(c.id, y);
                          return (
                            <button
                              key={y}
                              type="button"
                              onClick={() => router.push(`/principal/departments/${id}/courses/${c.id}/timing/${y}/edit`)}
                              className="flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors"
                            >
                              <span className="flex items-center gap-1.5">
                                <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                                Year {y}
                              </span>
                              {t ? (
                                <span className="flex items-center gap-1 text-emerald-600 font-medium">
                                  <CheckCircle2 className="h-3 w-3" />
                                  {t.collegeStartTime}–{t.collegeEndTime} · {t.numberOfPeriods} periods
                                </span>
                              ) : (
                                <span className="text-muted-foreground">Not configured — tap to add</span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      <div className="space-y-1.5 border-t pt-2">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Academic Year</p>
                        {years.map((y) => {
                          const ay = getAcademicYear(c.id, y);
                          return (
                            <button
                              key={y}
                              type="button"
                              onClick={() => router.push(`/principal/departments/${id}/courses/${c.id}/academic-year/${y}/edit`)}
                              className="flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors"
                            >
                              <span className="flex items-center gap-1.5">
                                <CalendarClock className="h-3 w-3 text-muted-foreground shrink-0" />
                                Year {y}
                              </span>
                              {ay ? (
                                <span className="flex items-center gap-1 text-emerald-600 font-medium">
                                  <CheckCircle2 className="h-3 w-3" />
                                  {ay.label} — tap to advance
                                </span>
                              ) : (
                                <span className="text-muted-foreground">Not set — tap to add</span>
                              )}
                            </button>
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
