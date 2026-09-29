"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { CourseYearTimingForm } from "@/components/academics/CourseYearTimingForm";
import { toast } from "@/hooks/useToast";
import type { Course } from "@/types";

import Link from "next/link";
import { ArrowLeft, Clock, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function CourseYearTimingPage() {
  const router = useRouter();
  const { id, courseId, year } = useParams<{ id: string; courseId: string; year: string }>();
  const yearNum = Number(year);
  const backHref = `/principal/departments/${id}`;

  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/college/courses?departmentId=${encodeURIComponent(id)}`)
      .then((r) => r.json() as Promise<{ courses: Course[] }>)
      .then((d) => setCourse((d.courses ?? []).find((c) => c.id === courseId) ?? null))
      .catch(() => toast({ variant: "destructive", title: "Failed to load course" }))
      .finally(() => setLoading(false));
  }, [id, courseId]);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild className="h-8 -ml-2 text-muted-foreground hover:text-foreground">
              <Link href={backHref}>
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Back to Department
              </Link>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {loading ? "Course Timings" : `${course?.name ?? "Course"}`}
            </h1>
            {course?.code && (
              <Badge variant="secondary" className="font-mono text-xs px-2 py-0.5">
                {course.code}
              </Badge>
            )}
            <Badge variant="outline" className="text-xs px-2 py-0.5 gap-1 text-primary border-primary/30 bg-primary/5">
              <GraduationCap className="h-3.5 w-3.5" />
              Year {yearNum} Timings & Semesters
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Configure daily period timings, bell schedule, breaks, and academic semester calendar for Year {yearNum}.
          </p>
        </div>

        <Button variant="outline" size="sm" asChild className="h-9 shrink-0">
          <Link href={backHref}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Cancel & Return
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="h-96 rounded-xl border bg-muted/20 animate-pulse" />
      ) : (
        <CourseYearTimingForm
          departmentId={id}
          courseId={courseId}
          year={yearNum}
          onSaved={() => router.push(backHref)}
          onCancel={() => router.push(backHref)}
        />
      )}
    </div>
  );
}
