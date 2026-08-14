"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import type { Course, Department } from "@/types";

export default function HODTimetableCoursesPage() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
      fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
    ])
      .then(([coursesRes, deptsRes]) => {
        setCourses((coursesRes.courses ?? []).sort((a, b) => a.name.localeCompare(b.name)));
        setDepartments(deptsRes.departments ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load courses" }))
      .finally(() => setIsLoading(false));
  }, []);

  // Each department owns its own course row for the same catalog programme
  // and builds its own timetable under it, so - unlike Sections - these can't
  // be merged into one card. Append the owning department's name whenever more
  // than one course shares a display name, so the cards read as distinct
  // destinations instead of confusing duplicates.
  const courseNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of courses) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
    return counts;
  }, [courses]);
  const deptNameById = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);
  const courseLabel = (c: Course) => (courseNameCounts.get(c.name) ?? 0) > 1
    ? `${c.name} — ${deptNameById.get(c.departmentId) ?? "?"}`
    : c.name;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable"
        description="Pick a course to build and publish its section timetables"
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : courses.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No courses have been set up for your department yet. Ask the Principal to add courses under Departments first.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <Card
              key={c.id}
              className="cursor-pointer transition-colors hover:border-primary/50"
              onClick={() => router.push(`/hod/timetable/${c.id}`)}
            >
              <CardContent className="p-4 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <Badge variant="secondary" className="text-xs font-mono mb-1">{c.code}</Badge>
                  <p className="font-semibold text-sm flex items-center gap-1.5">
                    <GraduationCap className="h-4 w-4 text-muted-foreground shrink-0" />
                    {courseLabel(c)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.durationYears} year{c.durationYears !== 1 ? "s" : ""}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
