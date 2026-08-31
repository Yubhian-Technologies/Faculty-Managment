"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import { buildCourseGroups } from "@/lib/departments/hodScope";
import type { Course, Department } from "@/types";

export default function HODTimetableCoursesPage() {
  const router = useRouter();
  const myDepartments = useMyDepartments();
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

  // Collapse the several Course docs that represent one catalog programme
  // into a single card - same grouping Sections uses (buildCourseGroups).
  // Without this, a shared-first-year manager (Basic Science) saw its own
  // "Bachelor of Technology" AND each managed branch's own doc for the same
  // programme as separate, confusingly-identical tiles - only the manager's
  // own doc actually resolves any years/sections for THIS viewer (see
  // [courseId]/page.tsx's years computation), so the branch-owned duplicates
  // were dead ends, not real destinations.
  const courseGroups = useMemo(() => buildCourseGroups(courses), [courses]);
  const deptNameById = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);
  // This HOD's own top-level department ids (never a managed branch) - used
  // to prefer linking a group to the caller's OWN doc over a sibling branch's,
  // same preference hod/sections/page.tsx's openCreate() already applies.
  const ownDeptIds = useMemo(
    () => new Set(myDepartments.map((n) => departments.find((d) => d.name === n)?.id).filter((id): id is string => !!id)),
    [myDepartments, departments]
  );
  // A legacy (pre-catalog) course has no catalogId, so buildCourseGroups
  // falls back to grouping by normalized name - two departments could
  // coincidentally share a name without any real relationship, so the
  // department suffix stays for that ambiguous case only.
  const groupNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of courseGroups) counts.set(g.name, (counts.get(g.name) ?? 0) + 1);
    return counts;
  }, [courseGroups]);

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
      ) : courseGroups.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No courses have been set up for your department yet. Ask the Principal to add courses under Departments first.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {courseGroups.map((g) => {
            const own = g.courseIds.find((id) => ownDeptIds.has(courses.find((c) => c.id === id)?.departmentId ?? ""));
            const representative = courses.find((c) => c.id === (own ?? g.courseIds[0]));
            const label = (groupNameCounts.get(g.name) ?? 0) > 1 && representative
              ? `${g.name} — ${deptNameById.get(representative.departmentId) ?? "?"}`
              : g.name;
            return (
              <Card
                key={g.key}
                className="cursor-pointer transition-colors hover:border-primary/50"
                onClick={() => router.push(`/hod/timetable/${own ?? g.courseIds[0]}`)}
              >
                <CardContent className="p-4 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    {representative?.code && (
                      <Badge variant="secondary" className="text-xs font-mono mb-1">{representative.code}</Badge>
                    )}
                    <p className="font-semibold text-sm flex items-center gap-1.5">
                      <GraduationCap className="h-4 w-4 text-muted-foreground shrink-0" />
                      {label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{g.durationYears} year{g.durationYears !== 1 ? "s" : ""}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
