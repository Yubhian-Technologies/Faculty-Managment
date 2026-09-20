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
import { type DepartmentWithId } from "@/lib/college/academicStructure";
import { toast } from "@/hooks/useToast";
import type { CourseCatalogItem, Department } from "@/types";

export default function NewCoursePage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [catalog, setCatalog] = useState<CourseCatalogItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogId, setCatalogId] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Every course now decides its own Years Taught at creation time - there's
  // no department-level flat default to fall back to anymore (Add/Edit
  // Department no longer offers one). Left blank rather than pre-filled, so
  // the Principal makes an explicit choice for each course (e.g. a B.Tech
  // shares Basic Science's first year while an M.Tech added to the same
  // department usually needs its own, different years). Always bounded to
  // 1..durationYears (YearsTaughtAndSecondaryFields) - the server opens
  // whichever of those years the college hasn't already opened
  // (ensureAssignedYearsOpen, college/courses POST), so there's no separate
  // "open academic years first" step to do here anymore.
  //
  // Secondary Departments is NOT decided here - it always follows the
  // department's own flat `secondaryDepartments` (set on Add/Edit
  // Department), so it can't be re-picked and silently diverge per course.
  const [structureAssignedYears, setStructureAssignedYears] = useState<number[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/college/course-catalog").then((r) => r.json() as Promise<{ items: CourseCatalogItem[] }>),
      fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
    ])
      .then(([catalogRes, deptsRes]) => {
        setCatalog((catalogRes.items ?? []).filter((c) => c.isActive));
        setDepartments(deptsRes.departments ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load courses" }))
      .finally(() => setLoading(false));
  }, []);

  const selected = useMemo(() => catalog.find((c) => c.id === catalogId), [catalog, catalogId]);
  const ownDept = useMemo(() => departments.find((d) => d.id === id) as DepartmentWithId | undefined, [departments, id]);

  function toggleStructureYear(year: number, checked: boolean) {
    setStructureAssignedYears((prev) => (checked ? [...prev, year].sort((a, b) => a - b) : prev.filter((y) => y !== year)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!catalogId) {
      toast({ variant: "destructive", title: "Please select a course" });
      return;
    }
    if (structureAssignedYears.length === 0) {
      toast({ variant: "destructive", title: "Select at least one year this department teaches this course" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: id,
          catalogId,
          // Every course now sets its own Years Taught atomically with
          // creation - the server requires this unconditionally. Secondary
          // Departments is NOT sent -
          // the server always derives it from this department's own flat
          // secondaryDepartments field instead.
          courseScope: { assignedYears: structureAssignedYears },
        }),
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
                No courses are set up yet. Add your college&apos;s courses in the Courses module first, then select them here.
              </p>
              <Button asChild variant="outline">
                <Link href="/principal/courses">Go to Courses</Link>
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
                  Courses are created in the Courses module. Select one — its code and duration fill in
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

              {selected && (
                <YearsTaughtAndSecondaryFields
                  assignedYears={structureAssignedYears}
                  onToggleYear={toggleStructureYear}
                  maxYear={selected.durationYears}
                  yearsHelperText={`Which years of this ${selected.durationYears}-year course this department teaches. HODs can only create sections for these years.`}
                  secondaryDepartmentOptions={departments.filter((d) => d.id !== id && !d.parentDepartmentId)}
                  secondaryDepartments={ownDept?.secondaryDepartments ?? []}
                  onToggleSecondaryDepartment={() => {}}
                  showSecondaryDepartments={false}
                  secondaryDepartmentsNote={
                    (ownDept?.secondaryDepartments?.length ?? 0) > 0
                      ? `Cross-listed with ${ownDept!.secondaryDepartments!.join(", ")} - set on ${ownDept?.name ?? "this department"}'s own page, not per course.`
                      : `${ownDept?.name ?? "This department"} has no Core Departments set - edit the department to cross-list it to others.`
                  }
                />
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
                <Button type="submit" loading={isSaving} disabled={!catalogId || structureAssignedYears.length === 0}>Add Course</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
