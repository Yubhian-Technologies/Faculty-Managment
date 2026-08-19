"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { resolveDepartmentCourseScope } from "@/lib/college/academicStructure";
import type { Course, CourseYearTiming, Department } from "@/types";

// College Office's own entry point into the same "set the college day's
// bounds per course-year" screen the Principal manages under Departments -
// see college/course-year-timings/route.ts POST, which grants both roles.
// Trimmed to just that one concern (no course add/edit/delete, no academic-
// structure or academic-year editing - those stay Principal-only) since
// Office isn't scoped to one department the way an HOD is and has no
// business touching the rest of a department's setup.
export default function CollegeOfficeTimingsPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => {
        const topLevel = (d.departments ?? []).filter((dept) => !dept.parentDepartmentId);
        setDepartments(topLevel.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load departments" }))
      .finally(() => setIsLoading(false));
  }, []);

  const selectedDepartment = useMemo(
    () => departments.find((d) => d.id === selectedDepartmentId) ?? null,
    [departments, selectedDepartmentId]
  );

  const loadCourses = useCallback(async (departmentId: string) => {
    setIsLoadingCourses(true);
    setCourses([]);
    setTimings([]);
    try {
      const res = await fetch(`/api/college/courses?departmentId=${encodeURIComponent(departmentId)}`);
      const data = await res.json() as { courses: Course[] };
      const sorted = (data.courses ?? [])
        .filter((c) => c.isActive && c.departmentId === departmentId)
        .sort((a, b) => a.name.localeCompare(b.name));
      setCourses(sorted);

      const timingLists = await Promise.all(
        sorted.map((c) =>
          fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(c.id)}`)
            .then((r) => r.json() as Promise<{ timings: CourseYearTiming[] }>)
            .then((d) => d.timings ?? [])
        )
      );
      setTimings(timingLists.flat());
    } catch {
      toast({ variant: "destructive", title: "Failed to load courses" });
    } finally {
      setIsLoadingCourses(false);
    }
  }, []);

  function selectDepartment(departmentId: string) {
    setSelectedDepartmentId(departmentId);
    void loadCourses(departmentId);
  }

  function getTiming(courseId: string, year: number): CourseYearTiming | undefined {
    return timings.find((t) => t.courseId === courseId && t.year === year);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Semester Timings"
        description="Set the college day's start/end time, periods and breaks for each course's years"
      />

      <Card>
        <CardContent className="p-4">
          <div className="space-y-1.5 max-w-xs">
            <Label>Department</Label>
            <Select value={selectedDepartmentId} onValueChange={selectDepartment} disabled={isLoading}>
              <SelectTrigger><SelectValue placeholder={isLoading ? "Loading…" : "Select department"} /></SelectTrigger>
              <SelectContent>
                {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!selectedDepartment ? (
        <p className="text-sm text-muted-foreground px-1">Select a department to see its courses.</p>
      ) : isLoadingCourses ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-32 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : courses.length === 0 ? (
        <p className="text-sm text-muted-foreground px-1">No courses yet for {selectedDepartment.name}.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => {
            const allYears = Array.from({ length: c.durationYears }, (_, i) => i + 1);
            const scope = resolveDepartmentCourseScope(selectedDepartment, c.catalogId);
            const years = scope.assignedYears.length > 0
              ? allYears.filter((y) => scope.assignedYears.includes(y))
              : allYears;
            return (
              <div key={c.id} className="rounded-lg border p-3 space-y-3">
                <div>
                  <Badge variant="secondary" className="text-xs font-mono mb-1">{c.code}</Badge>
                  <p className="font-semibold text-sm">{c.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.durationYears} year{c.durationYears !== 1 ? "s" : ""}</p>
                </div>

                <div className="space-y-1.5 border-t pt-2">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Year Timings</p>
                  {years.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No years assigned to this department yet.</p>
                  ) : years.map((y) => {
                    const t = getTiming(c.id, y);
                    return (
                      <div
                        key={y}
                        onClick={() => router.push(`/college-office/timings/${selectedDepartmentId}/${c.id}/${y}/edit`)}
                        className="flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs hover:bg-muted/50 transition-colors cursor-pointer"
                      >
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
                          <span className="text-muted-foreground">Not configured - tap to add</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
