"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import type { Course, CourseAcademicYear } from "@/types";

// "2025-2026" -> "2026-2027"; falls back to blank if the label isn't in that shape.
function suggestNextLabel(label: string): string {
  const match = /^(\d{4})\s*-\s*(\d{4})$/.exec(label.trim());
  if (!match) return "";
  return `${Number(match[1]) + 1}-${Number(match[2]) + 1}`;
}

export default function CourseAcademicYearPage() {
  const router = useRouter();
  const { id, courseId, year } = useParams<{ id: string; courseId: string; year: string }>();
  const yearNum = Number(year);

  const [course, setCourse] = useState<Course | null>(null);
  const [existing, setExisting] = useState<CourseAcademicYear | null>(null);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [coursesRes, academicYearsRes] = await Promise.all([
          fetch(`/api/college/courses?departmentId=${encodeURIComponent(id)}`).then((r) => r.json() as Promise<{ courses: Course[] }>),
          fetch(`/api/college/course-academic-years?courseId=${encodeURIComponent(courseId)}`).then((r) => r.json() as Promise<{ academicYears: CourseAcademicYear[] }>),
        ]);
        setCourse((coursesRes.courses ?? []).find((c) => c.id === courseId) ?? null);

        const found = (academicYearsRes.academicYears ?? []).find((a) => a.year === yearNum) ?? null;
        setExisting(found);
        setLabel(found ? suggestNextLabel(found.label) : "");
      } catch {
        toast({ variant: "destructive", title: "Failed to load academic year" });
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [id, courseId, yearNum]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) {
      toast({ variant: "destructive", title: "Academic year label is required" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/course-academic-years", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: id,
          courseId,
          year: yearNum,
          label: label.trim(),
        }),
      });
      const json = await res.json() as { error?: string; advanced?: boolean; facultyUpdated?: number };
      if (!res.ok) throw new Error(json.error ?? "Failed to save academic year");
      toast({
        variant: "success",
        title: json.advanced
          ? `Advanced to ${label.trim()} — ${json.facultyUpdated ?? 0} faculty member${json.facultyUpdated === 1 ? "" : "s"} updated`
          : `Academic year set for ${course?.name ?? "course"} — Year ${yearNum}`,
      });
      router.push(`/principal/departments/${id}`);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save academic year" });
    } finally {
      setIsSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Academic Year" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title={`${course?.name ?? "Course"} — Year ${yearNum} Academic Year`}
        description={existing ? "Advance the academic year for this course-year" : "Set the academic year for this course-year"}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            Academic Year Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {existing ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                Currently <strong>{existing.label}</strong>. Saving a new label here
                will be treated as advancing the academic year — every active faculty member with a teaching assignment in this course/year will have
                their Total Experience and Internal Experience increased by 1 year.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                First-time setup — this just records the current academic year for this course/year. No experience will be changed.
              </p>
            )}
            <div className="space-y-2">
              <Label>Academic Year Label</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. 2025-2026"
              />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={isSaving}>{existing ? "Advance" : "Save"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
