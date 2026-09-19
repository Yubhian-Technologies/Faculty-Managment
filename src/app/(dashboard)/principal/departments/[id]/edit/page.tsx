"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { YearsTaughtAndSecondaryFields } from "@/components/college/YearsTaughtAndSecondaryFields";
import { departmentSchema, type DepartmentFormData } from "@/lib/validations";
import { toast } from "@/hooks/useToast";
import type { Department } from "@/types";

export default function EditDepartmentPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [department, setDepartment] = useState<Department | null>(null);
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [hasSubDepartments, setHasSubDepartments] = useState(false);
  // Only meaningful when hasSubDepartments is true - see
  // Department.parentRunsOwnSections's own doc-comment (src/types/core.ts).
  // Unset on the loaded department (every department before this field
  // existed) defaults to true, its own documented backward-compatible
  // default.
  const [parentRunsOwnSections, setParentRunsOwnSections] = useState(true);
  const [secondaryDepartments, setSecondaryDepartments] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Set when the server rejects turning "parent runs its own sections" off
  // because this department already has real Section docs directly under it
  // (HAS_EXISTING_SECTIONS - see college/departments PATCH). Holds the exact
  // payload that was rejected so confirming can resubmit it unchanged, just
  // with the acknowledgement flag added.
  const [existingSectionsWarning, setExistingSectionsWarning] = useState<
    { message: string; payload: Record<string, unknown> } | null
  >(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DepartmentFormData>({
    resolver: zodResolver(departmentSchema),
  });

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const deptRes = await fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>);
        const dept = (deptRes.departments ?? []).find((d) => d.id === id) ?? null;
        if (!dept) {
          toast({ variant: "destructive", title: "Department not found" });
          router.push("/principal/departments");
          return;
        }
        setDepartment(dept);
        setAllDepartments(deptRes.departments ?? []);
        setHasSubDepartments(dept.hasSubDepartments ?? false);
        setParentRunsOwnSections(dept.parentRunsOwnSections ?? true);
        setSecondaryDepartments(dept.secondaryDepartments ?? []);
        reset({ name: dept.name, code: dept.code });
      } catch {
        toast({ variant: "destructive", title: "Failed to load department" });
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [id, reset, router]);

  function toggleSecondaryDepartment(name: string, checked: boolean) {
    setSecondaryDepartments((prev) => (checked ? [...prev, name] : prev.filter((n) => n !== name)));
  }

  // Shared by the normal submit and the warning dialog's "confirm and save
  // anyway" - `extra` carries `confirmExistingSections: true` on the retry so
  // the server skips the HAS_EXISTING_SECTIONS check it already showed.
  async function submitPatch(payload: Record<string, unknown>, extra?: Record<string, unknown>) {
    const res = await fetch("/api/college/departments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(extra ? { ...payload, ...extra } : payload),
    });
    if (!res.ok) {
      const json = await res.json() as { error?: string; code?: string };
      if (json.code === "HAS_EXISTING_SECTIONS") {
        setExistingSectionsWarning({ message: json.error ?? "This department already has sections.", payload });
        return false;
      }
      throw new Error(json.error ?? "Failed");
    }
    return true;
  }

  const onSubmit = async (data: DepartmentFormData) => {
    if (!department) return;
    setIsSubmitting(true);
    try {
      const payload = {
        deptId: department.id,
        name: data.name,
        code: data.code.toUpperCase(),
        hasSubDepartments,
        ...(hasSubDepartments ? { parentRunsOwnSections } : {}),
        secondaryDepartments,
      };
      const saved = await submitPatch(payload);
      if (!saved) return; // warning dialog now showing - wait for the Principal's decision
      toast({ variant: "success", title: "Department updated" });
      router.push("/principal/departments");
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setIsSubmitting(false);
    }
  };

  async function confirmExistingSectionsAndSave() {
    if (!existingSectionsWarning) return;
    setIsSubmitting(true);
    try {
      await submitPatch(existingSectionsWarning.payload, { confirmExistingSections: true });
      toast({ variant: "success", title: "Department updated" });
      setExistingSectionsWarning(null);
      router.push("/principal/departments");
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Edit Department" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Edit Department"
        description={department?.name}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Department Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dept-name">Department Name *</Label>
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
              <p className="text-sm">
                {department?.hodName ? department.hodName : <span className="text-amber-600">Vacant</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                The HOD is a seat a person holds on top of their own faculty login - appoint or change them in{" "}
                <Link href="/principal/role-assignments" className="text-primary underline underline-offset-2">Role Assignments</Link>.
              </p>
            </div>

            <YearsTaughtAndSecondaryFields
              showYears={false}
              assignedYears={[]}
              onToggleYear={() => {}}
              yearsHelperText=""
              // A sub-department can be a valid target too (e.g. feeding
              // "ECE-VLSI" specifically, not just plain ECE) - excluded here
              // are only this department itself and its OWN direct children,
              // which are redundant targets (already reachable directly via
              // Add Section's Department picker, not through cross-listing).
              secondaryDepartmentOptions={allDepartments.filter((d) => d.id !== department?.id && d.parentDepartmentId !== department?.id)}
              secondaryDepartments={secondaryDepartments}
              onToggleSecondaryDepartment={toggleSecondaryDepartment}
            />

            {!department?.parentDepartmentId && (
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
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={isSubmitting}>Save Changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!existingSectionsWarning}
        onOpenChange={(open) => {
          if (open) return;
          // "Keep it on" / closing without confirming abandons the change -
          // reset the checkbox back to checked so the form doesn't silently
          // show "off" for a toggle that was never actually saved.
          setExistingSectionsWarning(null);
          setParentRunsOwnSections(true);
        }}
        title="This department already has its own sections"
        description={existingSectionsWarning?.message}
        confirmLabel="Turn off anyway"
        cancelLabel="Keep it on"
        variant="destructive"
        loading={isSubmitting}
        onConfirm={confirmExistingSectionsAndSave}
      />
    </div>
  );
}
