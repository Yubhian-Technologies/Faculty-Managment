"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import { deriveHodScope, managerEffectiveYears } from "@/lib/departments/hodScope";
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

  // True if ANY of this HOD's own departments reaches branches through a
  // managed relationship (Basic Science's cascade, or a sub-HOD who IS the
  // grouping container) - decides which of the two branches below applies.
  const viewsManagedBranchYears = myDepartments.some((name) => deriveHodScope(departments, name).viewsManagedBranchYears);
  // This HOD's own top-level department (their first, for the common
  // single-department case - see hod/sections/page.tsx's identical `ownDept`).
  const ownDept = useMemo(() => departments.find((d) => d.name === myDepartments[0]) ?? null, [departments, myDepartments]);
  const years = (() => {
    if (!course) return [];
    // A viewer who reaches branches through a managed relationship can only
    // ever BUILD a timetable for the shared year(s) THEY OWN - resolved from
    // their own department, never unioned with a sibling branch's own
    // (unrelated) later years, regardless of which sibling Course doc (this
    // manager's own, or a branch's own) happens to be the id in this URL.
    // Mirrors hod/sections/page.tsx's own "All Departments" aggregate view,
    // which resolves the exact same way (managerEffectiveYears on ownDept
    // directly, no union across branches - see its yearTabOptions). Unioning
    // yearsInScope across manager+branches here was tried and reverted: a
    // branch's own fedYears exclusion cancels the manager's shared year back
    // out the moment both are in the same call.
    if (viewsManagedBranchYears) {
      if (!ownDept) return [];
      return managerEffectiveYears(ownDept, departments, course.catalogId);
    }
    // Plain viewer: this course doc's own department's own effective years -
    // same helper, just pointed at the doc's own department instead.
    const dept = departments.find((d) => d.id === course.departmentId);
    if (!dept) return [];
    return managerEffectiveYears(dept, departments, course.catalogId);
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
