"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import type { Course } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function HODTimetableYearsPage() {
  const router = useRouter();
  const { courseId } = useParams<{ courseId: string }>();
  const [course, setCourse] = useState<Course | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/courses")
      .then((r) => r.json() as Promise<{ courses: Course[] }>)
      .then((d) => {
        const found = (d.courses ?? []).find((c) => c.id === courseId) ?? null;
        if (!found) toast({ variant: "destructive", title: "Course not found" });
        setCourse(found);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load course" }))
      .finally(() => setIsLoading(false));
  }, [courseId]);

  const years = course ? Array.from({ length: course.durationYears }, (_, i) => i + 1) : [];

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
