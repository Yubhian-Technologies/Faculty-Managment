"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { Course, CourseCatalogItem } from "@/types";

export default function EditCoursePage() {
  const router = useRouter();
  const { id, courseId } = useParams<{ id: string; courseId: string }>();

  const [catalog, setCatalog] = useState<CourseCatalogItem[]>([]);
  const [current, setCurrent] = useState<Course | null>(null);
  const [catalogId, setCatalogId] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/college/courses?departmentId=${encodeURIComponent(id)}`)
        .then((r) => r.json() as Promise<{ courses: Course[] }>),
      fetch("/api/college/course-catalog")
        .then((r) => r.json() as Promise<{ items: CourseCatalogItem[] }>),
    ])
      .then(([{ courses }, { items }]) => {
        const course = (courses ?? []).find((c) => c.id === courseId);
        if (!course) {
          toast({ variant: "destructive", title: "Course not found" });
          router.push(`/principal/departments/${id}`);
          return;
        }
        setCurrent(course);
        // Keep the active list, but always include the entry this course already
        // points to so a deactivated one still shows as the current selection.
        const active = (items ?? []).filter((c) => c.isActive || c.id === course.catalogId);
        setCatalog(active);
        if (course.catalogId && active.some((c) => c.id === course.catalogId)) {
          setCatalogId(course.catalogId);
        }
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load course" }))
      .finally(() => setLoading(false));
  }, [id, courseId, router]);

  const selected = useMemo(() => catalog.find((c) => c.id === catalogId), [catalog, catalogId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!catalogId) {
      toast({ variant: "destructive", title: "Please select a course" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/college/courses/${courseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogId }),
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
          {catalog.length === 0 ? (
            <div className="space-y-4 text-center py-4">
              <p className="text-sm text-muted-foreground">
                No courses are set up yet. Add your college&apos;s courses in Settings first.
              </p>
              <Button asChild variant="outline">
                <Link href="/principal/settings">Go to Settings</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {current && !current.catalogId && (
                <p className="text-xs rounded-md border bg-muted/40 px-3 py-2 text-muted-foreground">
                  This course was created before the course catalog. It is currently
                  &quot;<span className="font-medium">{current.name}</span>&quot;. Pick its matching catalog course to
                  standardise it.
                </p>
              )}
              <div className="space-y-2">
                <Label>Course *</Label>
                <Select value={catalogId} onValueChange={setCatalogId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a course" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.code}){!c.isActive ? " — inactive" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Short Code</Label>
                  <Input value={selected?.code ?? ""} readOnly disabled placeholder="—" className="uppercase" />
                </div>
                <div className="space-y-2">
                  <Label>Duration (Years)</Label>
                  <Input value={selected ? String(selected.durationYears) : ""} readOnly disabled placeholder="—" />
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
                <Button type="submit" loading={isSaving} disabled={!catalogId}>Save Changes</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
