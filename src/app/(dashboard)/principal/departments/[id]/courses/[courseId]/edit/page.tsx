"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { stripLeadingZeros } from "@/lib/utils";
import type { Course } from "@/types";

type CourseForm = { name: string; code: string; durationYears: string };
const EMPTY_COURSE_FORM: CourseForm = { name: "", code: "", durationYears: "4" };

export default function EditCoursePage() {
  const router = useRouter();
  const { id, courseId } = useParams<{ id: string; courseId: string }>();
  const [courseForm, setCourseForm] = useState<CourseForm>(EMPTY_COURSE_FORM);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/college/courses?departmentId=${encodeURIComponent(id)}`)
      .then((r) => r.json() as Promise<{ courses: Course[] }>)
      .then((d) => {
        const course = (d.courses ?? []).find((c) => c.id === courseId);
        if (!course) {
          toast({ variant: "destructive", title: "Course not found" });
          router.push(`/principal/departments/${id}`);
          return;
        }
        setCourseForm({ name: course.name, code: course.code, durationYears: String(course.durationYears) });
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load course" }))
      .finally(() => setLoading(false));
  }, [id, courseId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!courseForm.name.trim() || !courseForm.code.trim() || !courseForm.durationYears) {
      toast({ variant: "destructive", title: "Name, code and duration are required" });
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        departmentId: id,
        name: courseForm.name.trim(),
        code: courseForm.code.trim(),
        durationYears: Number(courseForm.durationYears),
      };
      const res = await fetch(`/api/college/courses/${courseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed to save course");
      }
      toast({ variant: "success", title: "Course updated" });
      router.push(`/principal/departments/${id}`);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save course" });
    } finally {
      setIsSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Edit Course" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Edit Course" description="Update course details" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Course Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Course Name *</Label>
              <Input
                value={courseForm.name}
                onChange={(e) => setCourseForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. B.Pharm, BDS, B.Tech"
              />
            </div>
            <div className="space-y-2">
              <Label>Short Code *</Label>
              <Input
                value={courseForm.code}
                onChange={(e) => setCourseForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="e.g. BTECH"
                className="uppercase"
                maxLength={10}
              />
            </div>
            <div className="space-y-2">
              <Label>Duration (Years) *</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={courseForm.durationYears}
                onChange={(e) => setCourseForm((f) => ({ ...f, durationYears: stripLeadingZeros(e.target.value) }))}
              />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={isSaving}>Save Changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
