"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { stripLeadingZeros } from "@/lib/utils";

type CourseForm = { name: string; code: string; durationYears: string };
const EMPTY_COURSE_FORM: CourseForm = { name: "", code: "", durationYears: "4" };

export default function NewCoursePage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [courseForm, setCourseForm] = useState<CourseForm>(EMPTY_COURSE_FORM);
  const [isSaving, setIsSaving] = useState(false);

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
      const res = await fetch("/api/college/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed to save course");
      }
      toast({ variant: "success", title: "Course added" });
      router.push(`/principal/departments/${id}`);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save course" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Add Course" description="Add a course offered by this department" />

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
              <Button type="submit" loading={isSaving}>Add Course</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
