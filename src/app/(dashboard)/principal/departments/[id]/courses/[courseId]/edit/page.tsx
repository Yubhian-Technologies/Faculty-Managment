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
import { YearsTaughtAndSecondaryFields } from "@/components/college/YearsTaughtAndSecondaryFields";
import { resolveDepartmentCourseScope } from "@/lib/college/academicStructure";
import { toast } from "@/hooks/useToast";
import type { Course, CourseCatalogItem, Department } from "@/types";

export default function EditCoursePage() {
  const router = useRouter();
  const { id, courseId } = useParams<{ id: string; courseId: string }>();

  const [catalog, setCatalog] = useState<CourseCatalogItem[]>([]);
  const [current, setCurrent] = useState<Course | null>(null);
  const [catalogId, setCatalogId] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  // Years Taught for THIS course in THIS department - stored on the department
  // (Department.courseScopes), not on the course, since the same catalog
  // programme can run different years in different departments. Edited here
  // rather than behind a separate icon on the department page: both are "edit
  // this course in this department", and splitting them made the academic
  // structure easy to miss entirely.
  const [department, setDepartment] = useState<Department | null>(null);
  const [assignedYears, setAssignedYears] = useState<number[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/college/courses?departmentId=${encodeURIComponent(id)}`)
        .then((r) => r.json() as Promise<{ courses: Course[] }>),
      fetch("/api/college/course-catalog")
        .then((r) => r.json() as Promise<{ items: CourseCatalogItem[] }>),
      fetch("/api/college/departments")
        .then((r) => r.json() as Promise<{ departments: Department[] }>),
    ])
      .then(([{ courses }, { items }, { departments }]) => {
        const course = (courses ?? []).find((c) => c.id === courseId);
        if (!course) {
          toast({ variant: "destructive", title: "Course not found" });
          router.push(`/principal/departments/${id}`);
          return;
        }
        setCurrent(course);
        const all = departments ?? [];
        const dept = all.find((d) => d.id === id) ?? null;
        setDepartment(dept);
        // A sub-department that has set no years of its own for this course
        // follows its parent's - the same fallback the department page applies.
        const own = dept
          ? resolveDepartmentCourseScope(dept, course.catalogId)
          : { assignedYears: [], secondaryDepartments: [] };
        const parent = dept?.parentDepartmentId ? all.find((d) => d.id === dept.parentDepartmentId) : undefined;
        setAssignedYears(
          own.assignedYears.length > 0 || !parent
            ? own.assignedYears
            : resolveDepartmentCourseScope(parent, course.catalogId).assignedYears
        );
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

  function toggleYear(year: number, checked: boolean) {
    setAssignedYears((prev) => (checked ? [...prev, year].sort((a, b) => a - b) : prev.filter((y) => y !== year)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!catalogId) {
      toast({ variant: "destructive", title: "Please select a course" });
      return;
    }
    // Switching to a shorter programme can leave years selected that no longer
    // exist, so the list is clamped to the course's real span before it is
    // judged empty or saved.
    const years = assignedYears.filter((y) => y <= (selected?.durationYears ?? 0));
    if (years.length === 0) {
      toast({ variant: "destructive", title: "Select at least one year this department teaches this course" });
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
      // Years live on the DEPARTMENT, keyed by the catalog programme, so this is
      // a second write - and it is keyed by whichever catalog course is now
      // selected, not the one loaded. Secondary Departments is deliberately not
      // sent; the server always derives it from the department's own field.
      if (department) {
        const scopeRes = await fetch("/api/college/departments", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deptId: department.id, courseScope: { catalogId, assignedYears: years } }),
        });
        if (!scopeRes.ok) {
          const json = await scopeRes.json() as { error?: string };
          throw new Error(json.error ?? "Course saved, but its years could not be updated");
        }
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
                No courses are set up yet. Add your college&apos;s courses in the Courses module first.
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

              <YearsTaughtAndSecondaryFields
                assignedYears={assignedYears}
                onToggleYear={toggleYear}
                maxYear={selected?.durationYears}
                yearsHelperText={`Which years of this ${selected?.durationYears ?? ""}-year course ${department?.name ?? "this department"} teaches. HODs can only create sections for these years.`}
                secondaryDepartmentOptions={[]}
                secondaryDepartments={department?.secondaryDepartments ?? []}
                onToggleSecondaryDepartment={() => {}}
                showSecondaryDepartments={false}
              />

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
                <Button type="submit" loading={isSaving} disabled={!catalogId || assignedYears.length === 0}>Save Changes</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
