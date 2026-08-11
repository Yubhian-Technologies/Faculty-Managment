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
import type { CourseCatalogItem } from "@/types";

export default function NewCoursePage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [catalog, setCatalog] = useState<CourseCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogId, setCatalogId] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch("/api/college/course-catalog")
      .then((r) => r.json() as Promise<{ items: CourseCatalogItem[] }>)
      .then((d) => setCatalog((d.items ?? []).filter((c) => c.isActive)))
      .catch(() => toast({ variant: "destructive", title: "Failed to load courses" }))
      .finally(() => setLoading(false));
  }, []);

  const selected = useMemo(() => catalog.find((c) => c.id === catalogId), [catalog, catalogId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!catalogId) {
      toast({ variant: "destructive", title: "Please select a course" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentId: id, catalogId }),
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
          {loading ? (
            <div className="h-24 bg-muted animate-pulse rounded-lg" />
          ) : catalog.length === 0 ? (
            <div className="space-y-4 text-center py-4">
              <p className="text-sm text-muted-foreground">
                No courses are set up yet. Add your college&apos;s courses in Settings first, then select them here.
              </p>
              <Button asChild variant="outline">
                <Link href="/principal/settings">Go to Settings</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Course *</Label>
                <Select value={catalogId} onValueChange={setCatalogId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a course" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Courses are managed by the Principal in Settings. Select one — its code and duration fill in
                  automatically.
                </p>
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
                <Button type="submit" loading={isSaving} disabled={!catalogId}>Add Course</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
