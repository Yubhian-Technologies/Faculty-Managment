"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { CourseYearTimingForm } from "@/components/academics/CourseYearTimingForm";
import { toast } from "@/hooks/useToast";
import type { Course } from "@/types";

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
    <div className="max-w-2xl">
      <PageHeader
        title={loading ? "Course Timings" : `${course?.name ?? "Course"} - Year ${yearNum} Timings`}
        description="Set college hours, periods and breaks for this course-year"
      />
      {loading ? (
        <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
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
