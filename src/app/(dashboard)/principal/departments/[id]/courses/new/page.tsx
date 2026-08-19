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
import {
  isSharedYearStructuralDepartment, findUnconnectedCourseOwners, type DepartmentWithId,
} from "@/lib/college/academicStructure";
import { toast } from "@/hooks/useToast";
import type { Course, CourseCatalogItem, Department } from "@/types";

export default function NewCoursePage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [catalog, setCatalog] = useState<CourseCatalogItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [existingCourses, setExistingCourses] = useState<Course[]>([]);
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
      // Unscoped - every course in the college, so a catalog course already
      // offered elsewhere can be spotted before it's added here too (see
      // conflictingDepartments below).
      fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
    ])
      .then(([catalogRes, deptsRes, coursesRes]) => {
        setCatalog((catalogRes.items ?? []).filter((c) => c.isActive));
        setDepartments(deptsRes.departments ?? []);
        setExistingCourses(coursesRes.courses ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load courses" }))
      .finally(() => setLoading(false));
  }, []);

  const selected = useMemo(() => catalog.find((c) => c.id === catalogId), [catalog, catalogId]);
  const ownDept = useMemo(() => departments.find((d) => d.id === id) as DepartmentWithId | undefined, [departments, id]);

  // Departments that already offer this catalog course with no declared
  // relationship to this one (neither cross-lists to the other for it) - a
  // Principal adding it here too would silently create a second, unrelated
  // program under the same catalog entry (e.g. Basic Science's own M.Tech,
  // unconnected to AIDS's). A genuine shared-first-year pair (Basic Science
  // cross-listing to AIDS for B.Tech) is excluded - that's the expected shape.
  // Reuses the exact function the server enforces with, so what's shown here
  // never disagrees with what actually gets rejected.
  const conflictingDepartments = useMemo(() => {
    if (!catalogId || !ownDept) return [];
    const otherIds = Array.from(new Set(
      existingCourses.filter((c) => c.catalogId === catalogId && c.departmentId !== id).map((c) => c.departmentId)
    ));
    return findUnconnectedCourseOwners(
      ownDept, catalogId, otherIds, departments as DepartmentWithId[], ownDept.secondaryDepartments ?? []
    );
  }, [catalogId, ownDept, existingCourses, departments, id]);

  // Basic Science adding an M.Tech unconnected to any branch is exactly the
  // accident this exists to stop: a department already acting as a
  // shared-year structural node must explicitly decide how a new,
  // conflicting course relates to its branches - it can't just be left to
  // silently follow whatever cross-listing already happens to be set. An
  // ordinary branch's own independent copy of a course is never blocked.
  // No longer gates whether the Years Taught / Secondary Departments fields
  // show (they're always required now) - only whether the warning banner
  // below renders as a hard requirement vs. an informational note.
  const structureRequired = !!ownDept && isSharedYearStructuralDepartment(ownDept) && conflictingDepartments.length > 0;

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
          // creation - the server requires this unconditionally (not just for
          // the structureRequired case). Secondary Departments is NOT sent -
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

              {selected && conflictingDepartments.length > 0 && (
                <div className={`rounded-md border p-3 text-xs ${structureRequired ? "border-destructive/50 bg-destructive/5 text-destructive" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
                  <p className="font-medium">Already offered elsewhere, unconnected to this department</p>
                  <p className="mt-1">
                    {selected.name} is already offered by{" "}
                    <span className="font-medium">{conflictingDepartments.map((d) => d.name).join(", ")}</span>,
                    with no shared-year link to {ownDept?.name ?? "this department"}.{" "}
                    {structureRequired
                      ? `${ownDept?.name ?? "This department"} already runs a shared-year structure elsewhere - this course will follow ${ownDept?.name ?? "this department"}'s own Secondary Departments setting, so double-check the Years Taught below are what you intend before adding.`
                      : `Adding it here too will create a second, independent ${selected.name} program under the same catalog course - fine if that's intended (e.g. every branch runs its own), but if ${selected.name} is meant to be shared, set Secondary Departments on ${ownDept?.name ?? "this department"} (or on ${conflictingDepartments[0]?.name}'s own department) to connect them instead.`}
                  </p>
                </div>
              )}

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
                      : `${ownDept?.name ?? "This department"} has no Secondary Departments set - edit the department to cross-list it to others.`
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
