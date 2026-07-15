"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import type { Course, Section } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function HODTimetableSectionsPage() {
  const router = useRouter();
  const { courseId, year } = useParams<{ courseId: string; year: string }>();
  const [course, setCourse] = useState<Course | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
      fetch(`/api/college/sections?courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}`)
        .then((r) => r.json() as Promise<{ sections: Section[] }>),
    ])
      .then(([coursesData, sectionsData]) => {
        setCourse((coursesData.courses ?? []).find((c) => c.id === courseId) ?? null);
        setSections((sectionsData.sections ?? []).sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load sections" }))
      .finally(() => setIsLoading(false));
  }, [courseId, year]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={course ? `${course.name} · ${ordinalYear(Number(year))}` : "Timetable"}
        description="Pick a section"
        actions={
          <Button variant="outline" onClick={() => router.push(`/hod/timetable/${courseId}`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back to Years
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : sections.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No sections have been created for this year yet. Add sections under the Sections module first.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <Card
              key={s.id}
              className="cursor-pointer transition-colors hover:border-primary/50"
              onClick={() => router.push(`/hod/timetable/${courseId}/${year}/${s.id}`)}
            >
              <CardContent className="p-4 flex items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-sm">Section {s.name}</p>
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
