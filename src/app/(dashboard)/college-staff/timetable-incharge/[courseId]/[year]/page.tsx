"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";
import type { Course, Department, Section } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

// COLLEGE_STAFF mirror of panel/timetable-incharge/[courseId]/[year]/page.tsx -
// a Timetable Incharge's own section picker for one delegated course-year,
// same shape as the HOD's own, minus the Incharge-assignment card itself
// (only the HOD manages that).
export default function TimetableInchargeSectionsPage() {
  const router = useRouter();
  const { courseId, year } = useParams<{ courseId: string; year: string }>();
  const [course, setCourse] = useState<Course | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [coursesData, sectionsData, deptsData] = await Promise.all([
          fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
          fetch(`/api/college/sections?courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}`)
            .then((r) => r.json() as Promise<{ sections: Section[] }>),
          fetch("/api/college/departments")
            .then((r) => r.json() as Promise<{ departments: Department[] }>),
        ]);
        if (cancelled) return;
        setCourse((coursesData.courses ?? []).find((c) => c.id === courseId) ?? null);
        setSections((sectionsData.sections ?? []).sort((a, b) => a.name.localeCompare(b.name)));
        setDepartments(deptsData.departments ?? []);
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load sections" });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [courseId, year]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={course ? `${course.name} · ${ordinalYear(Number(year))}` : "Timetable"}
        description="Pick a section"
        actions={
          <Button variant="outline" onClick={() => router.push("/college-staff/timetable-incharge")}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : sections.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No sections have been created for this year yet.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <Card
              key={s.id}
              className="cursor-pointer transition-colors hover:border-primary/50"
              onClick={() => router.push(`/college-staff/timetable-incharge/${courseId}/${year}/${s.id}`)}
            >
              <CardContent className="p-4 flex items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-sm">{sectionDisplayLabel(s, departments)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Users className="h-3 w-3" />{s.studentCount ?? 0} students
                  </p>
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
