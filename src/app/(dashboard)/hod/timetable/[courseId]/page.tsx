"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import { deriveHodScope, managedBranchYearsMap, yearsInScope } from "@/lib/departments/hodScope";
import type { Course, Department } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function HODTimetableYearsPage() {
  const router = useRouter();
  const { courseId } = useParams<{ courseId: string }>();
  const myDepartments = useMyDepartments();
  const [course, setCourse] = useState<Course | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
      fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
    ])
      .then(([c, d]) => {
        const found = (c.courses ?? []).find((x) => x.id === courseId) ?? null;
        if (!found) toast({ variant: "destructive", title: "Course not found" });
        setCourse(found);
        setDepartments(d.departments ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load course" }))
      .finally(() => setIsLoading(false));
  }, [courseId]);

  // Scoped to the course's own department's "Years Taught" - but for a
  // department reached through a managed-branch relationship (e.g. Basic
  // Science's HOD viewing CSE's own course row, now reachable as its own
  // tile - see the courses API's managed-branch union), also includes
  // whatever shared year the manager (BS-Maths, or Basic Science itself)
  // contributes via managedBranchYearsMap - otherwise the one year this HOD
  // actually needs to build a timetable for (the shared first year) would
  // never appear, even though the course tile itself is reachable. Mirrors
  // hod/sections/page.tsx's identical need (yearsInScope).
  // An HOD who heads more than one department may be viewing a course owned
  // by any one of them - true if ANY of their own departments would view
  // this relationship, since `years` below is already scoped to the course's
  // own owning department alone; this only widens which shared years are
  // included, never which department's data is shown.
  const viewsManagedBranchYears = myDepartments.some((name) => deriveHodScope(departments, name).viewsManagedBranchYears);
  const managedBranchYears = managedBranchYearsMap(departments, course?.catalogId);
  const years = (() => {
    if (!course) return [];
    const dept = departments.find((d) => d.id === course.departmentId);
    if (!dept) return [];
    return yearsInScope(course.durationYears, [dept], managedBranchYears, viewsManagedBranchYears, course.catalogId, departments);
  })();

  return (
    <div className="space-y-6">
      <PageHeader
        title={course ? course.name : "Timetable"}
        description={course ? `${course.code} · Pick a year` : "Loading…"}
        actions={
          <Button variant="outline" onClick={() => router.push("/hod/timetable")}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back to Courses
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : !course ? null : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {years.map((y) => (
            <Card
              key={y}
              className="cursor-pointer transition-colors hover:border-primary/50"
              onClick={() => router.push(`/hod/timetable/${courseId}/${y}`)}
            >
              <CardContent className="p-4 flex items-center justify-between gap-2">
                <p className="font-semibold text-sm flex items-center gap-1.5">
                  <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
                  {ordinalYear(y)}
                </p>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
