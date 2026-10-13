"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { YearsTaughtAndSecondaryFields } from "@/components/college/YearsTaughtAndSecondaryFields";
import { DepartmentCoursePicker, type CourseSelection } from "@/components/college/DepartmentCoursePicker";
import { departmentSchema, type DepartmentFormData } from "@/lib/validations";
import { toast } from "@/hooks/useToast";
import type { CourseCatalogItem, Department } from "@/types";

export default function NewDepartmentPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [secondaryDepartments, setSecondaryDepartments] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubDepartments, setHasSubDepartments] = useState(false);
  // Only meaningful when hasSubDepartments is true - see
  // Department.parentRunsOwnSections's own doc-comment (src/types/core.ts).
  // Defaults true: a brand-new department that never touches this checkbox
  // gets the same unrestricted behavior every department had before this
  // field existed.
  const [parentRunsOwnSections, setParentRunsOwnSections] = useState(true);
  // "Freshman's Department" - this tick, not the year/sub-department settings
  // around it, is what marks the department as the shared first-year one (see
  // Department.isFreshman's doc-comment, src/types/core.ts). Defaults off: a
  // brand-new department has no prior behavior to preserve, so the Principal's
  // choice here is the whole answer.
  const [isFreshman, setIsFreshman] = useState(false);
  // A department can't be created without at least one course - see
  // college/departments POST.
  const [catalog, setCatalog] = useState<CourseCatalogItem[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [courseSelections, setCourseSelections] = useState<CourseSelection[]>([]);

  useEffect(() => {
    fetch("/api/college/course-catalog")
      .then((r) => r.json() as Promise<{ items: CourseCatalogItem[] }>)
      .then((d) => setCatalog(d.items ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load courses" }))
      .finally(() => setCatalogLoaded(true));

    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments((d.departments ?? []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {});
  }, []);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<DepartmentFormData>({
    resolver: zodResolver(departmentSchema),
    defaultValues: { name: "", code: "" },
  });

  const nameValue = watch("name");
  // The department being created, as typed. CreateHodDialog stamps this exact
  // name onto the new HOD's own profile the moment the account is made, so it
  // is also what has to be discounted when reporting which OTHER departments
  // that HOD already heads.
  const pendingName = (nameValue ?? "").trim();

  function toggleSecondaryDepartment(name: string, checked: boolean) {
    setSecondaryDepartments((prev) => (checked ? [...prev, name] : prev.filter((n) => n !== name)));
  }

  const onSubmit = async (data: DepartmentFormData) => {
    if (courseSelections.length === 0) {
      toast({ variant: "destructive", title: "Select at least one course for this department" });
      return;
    }
    if (courseSelections.some((c) => c.assignedYears.length === 0)) {
      toast({ variant: "destructive", title: "Select at least one year for each chosen course" });
      return;
    }
    setIsSubmitting(true);
    try {
      const payload = {
        name: data.name,
        code: data.code.toUpperCase(),
        courses: courseSelections,
        hasSubDepartments,
        ...(hasSubDepartments ? { parentRunsOwnSections } : {}),
        secondaryDepartments: secondaryDepartments.length > 0 ? secondaryDepartments : undefined,
        // Always sent, even when false - this is an explicit choice on a
        // department that has no inferred behavior to fall back on yet.
        isFreshman,
      };
      const res = await fetch("/api/college/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed");
      }
      toast({ variant: "success", title: "Department added" });
      router.push("/principal/courses?tab=departments");
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setIsSubmitting(false);
    }
  };

return (
<div className="w-full max-w-4xl mx-auto space-y-6 pb-12">
      <PageHeader
        title="Add Department"
        description="Add a new department under one or more courses"
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Two columns on desktop: identity on the left, the course picker on
            the right. Both are short blocks that left the page a tall single
            ribbon; side by side the whole form reads at a glance and the
            cross-listing/structure sections below get the full width. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Department Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="dept-name">
                  Department Name * <span className="font-normal text-muted-foreground">(as per AICTE)</span>
                </Label>
                <Input
                  id="dept-name"
                  {...register("name")}
                  placeholder="e.g. Computer Science"
                />
                {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="dept-code">Short Code *</Label>
                <Input
                  id="dept-code"
                  {...register("code")}
                  placeholder="e.g. CS"
                  className="uppercase"
                  maxLength={10}
                />
                <p className="text-xs text-muted-foreground">2-10 uppercase letters, used in reports and batch IDs</p>
                {errors.code && <p className="text-sm text-destructive">{errors.code.message}</p>}
              </div>

              <div className="space-y-1 rounded-md border p-3">
                <Label>Head of Department</Label>
                <p className="text-xs text-muted-foreground">
                  A HOD seat is created automatically - appoint someone in Role Assignments.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Courses *</CardTitle>
              <CardDescription>
                Pick every course this department offers (e.g. CSE under both B.Tech and M.Tech) - it will be listed
                under each of them in the Courses module.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {catalogLoaded ? (
                <DepartmentCoursePicker catalog={catalog} value={courseSelections} onChange={setCourseSelections} />
              ) : (
                <div className="h-16 bg-muted animate-pulse rounded-md" />
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Core Departments available to link</CardTitle>
            <CardDescription>
              Optional. The head of each department picked gets view-only access to this department&apos;s sections and students.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <YearsTaughtAndSecondaryFields
              showYears={false}
              assignedYears={[]}
              onToggleYear={() => {}}
              yearsHelperText=""
              // A sub-department can be a valid target too (e.g. feeding
              // "ECE-VLSI" specifically, not just plain ECE) - this new
              // department has no children of its own yet, so nothing to
              // additionally exclude beyond its own (in-progress) name.
              secondaryDepartmentOptions={departments.filter((d) => d.name !== nameValue)}
              secondaryDepartments={secondaryDepartments}
              onToggleSecondaryDepartment={toggleSecondaryDepartment}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Structure</CardTitle>
            <CardDescription>
              How this department is organised and where its students begin.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2">
              <Checkbox
                id="dept-is-freshman"
                checked={isFreshman}
                onCheckedChange={(v) => setIsFreshman(v === true)}
              />
              <div className="space-y-1">
                <Label htmlFor="dept-is-freshman" className="font-normal">Freshman&apos;s Department</Label>
                <p className="text-xs text-muted-foreground">
                  Shared first year - year-1 students can only be filed under this department (or its sub-departments).
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2 border-t pt-3">
              <Checkbox
                id="dept-has-subdepts"
                checked={hasSubDepartments}
                onCheckedChange={(v) => setHasSubDepartments(v === true)}
              />
              <div className="space-y-1">
                <Label htmlFor="dept-has-subdepts" className="font-normal">Has sub-departments</Label>
                <p className="text-xs text-muted-foreground">
                  Splits this department into smaller ones, each with its own head, managed from the HOD&apos;s Sub-Departments page.
                </p>
              </div>
            </div>

            {hasSubDepartments && (
              <div className="flex items-start gap-2 ml-6 border-t pt-3">
                <Checkbox
                  id="dept-parent-runs-own-sections"
                  checked={parentRunsOwnSections}
                  onCheckedChange={(v) => setParentRunsOwnSections(v === true)}
                />
                <div className="space-y-1">
                  <Label htmlFor="dept-parent-runs-own-sections" className="font-normal">
                    This department also has its own sections/students, separate from its sub-departments
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Turn off only if every student belongs to a sub-department.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button
            type="submit"
            loading={isSubmitting}
            disabled={!catalogLoaded || courseSelections.length === 0}
          >
            Add Department
          </Button>
        </div>
      </form>
    </div>
  );
}
