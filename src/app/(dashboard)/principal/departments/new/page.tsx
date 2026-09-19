"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      router.push("/principal/departments");
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Add Department"
        description="Add a new department under one or more courses"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Department Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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

            <div className="space-y-2">
              <Label>Courses *</Label>
              <p className="text-xs text-muted-foreground">
                Pick every course this department offers (e.g. CSE under both B.Tech and M.Tech) - it will be listed
                under each of them in the Courses module.
              </p>
              {catalogLoaded ? (
                <DepartmentCoursePicker catalog={catalog} value={courseSelections} onChange={setCourseSelections} />
              ) : (
                <div className="h-16 bg-muted animate-pulse rounded-md" />
              )}
            </div>

            <div className="space-y-1 rounded-md border p-3">
              <Label>Head of Department</Label>
              <p className="text-xs text-muted-foreground">
                The department gets its own HOD seat automatically. Appoint someone to it afterwards in Role Assignments -
                the HOD is a seat a person holds on top of their own faculty login, not a separate account.
              </p>
            </div>

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

            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="dept-has-subdepts"
                  checked={hasSubDepartments}
                  onCheckedChange={(v) => setHasSubDepartments(v === true)}
                />
                <div className="space-y-1">
                  <Label htmlFor="dept-has-subdepts" className="font-normal">Has sub-departments</Label>
                  <p className="text-xs text-muted-foreground">
                    Enable if this department splits into sub-branches (e.g. a Freshman&apos;s Department like Basic
                    Science → BS-Maths, BS-English). The HOD will get a &quot;Sub-Departments&quot; page to add
                    sub-departments and assign sub-HODs.
                  </p>
                </div>
              </div>

              {hasSubDepartments && (
                <div className="flex items-start gap-2 ml-6 pt-3 border-t">
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
                      Turn this OFF if this department exists only to organize its sub-departments and never
                      enrolls students directly on its own - e.g. a &quot;Basic Science&quot; department whose
                      sub-departments (Maths, Physics, Chemistry, English) are the only place 1st-year students
                      actually sit. Leave it ON if this department itself also runs real sections in addition
                      to its sub-departments - e.g. an &quot;ECE&quot; department that has its own ECE sections
                      AND a further specialized &quot;ECE-VLSI&quot; sub-department with sections of its own.
                    </p>
                  </div>
                </div>
              )}
            </div>

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
        </CardContent>
      </Card>
    </div>
  );
}
