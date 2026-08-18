"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreateHodDialog } from "@/components/college/CreateHodDialog";
import { YearsTaughtAndSecondaryFields } from "@/components/college/YearsTaughtAndSecondaryFields";
import { departmentSchema, type DepartmentFormData } from "@/lib/validations";
import { toast } from "@/hooks/useToast";
import type { Department, FMSUser } from "@/types";

export default function EditDepartmentPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [department, setDepartment] = useState<Department | null>(null);
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [hods, setHods] = useState<FMSUser[]>([]);
  const [hasSubDepartments, setHasSubDepartments] = useState(false);
  const [secondaryDepartments, setSecondaryDepartments] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<DepartmentFormData>({
    resolver: zodResolver(departmentSchema),
  });

  const hodUid = watch("hodUid");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [deptRes, hodRes] = await Promise.all([
          fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
          fetch("/api/college/users?role=HOD").then((r) => r.json() as Promise<{ users: FMSUser[] }>),
        ]);
        const dept = (deptRes.departments ?? []).find((d) => d.id === id) ?? null;
        if (!dept) {
          toast({ variant: "destructive", title: "Department not found" });
          router.push("/principal/departments");
          return;
        }
        setDepartment(dept);
        setAllDepartments(deptRes.departments ?? []);
        setHods(hodRes.users ?? []);
        setHasSubDepartments(dept.hasSubDepartments ?? false);
        setSecondaryDepartments(dept.secondaryDepartments ?? []);
        reset({ name: dept.name, code: dept.code, hodUid: dept.hodUid ?? "" });
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

  async function handleHodCreated(uid: string) {
    if (!department) return;
    try {
      const res = await fetch("/api/college/users?role=HOD");
      const data = await res.json() as { users: FMSUser[] };
      const freshHods = data.users ?? [];
      setHods(freshHods);
      const newHod = freshHods.find((h) => h.uid === uid);

      const patchRes = await fetch("/api/college/departments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deptId: department.id,
          name: department.name,
          code: department.code,
          hodUid: uid,
          hodName: newHod?.name ?? "",
          hasSubDepartments,
        }),
      });
      if (!patchRes.ok) {
        const json = await patchRes.json() as { error?: string };
        throw new Error(json.error ?? "Failed to assign HOD");
      }

      setValue("hodUid", uid);
      setDepartment({ ...department, hodUid: uid, hodName: newHod?.name ?? "" });
      toast({ variant: "success", title: "HOD created and assigned" });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to assign HOD" });
    }
  }

  const onSubmit = async (data: DepartmentFormData) => {
    if (!department) return;
    setIsSubmitting(true);
    try {
      const selectedHod = hods.find((h) => h.uid === data.hodUid);
      const payload = {
        deptId: department.id,
        name: data.name,
        code: data.code.toUpperCase(),
        hodUid: data.hodUid ?? "",
        hodName: selectedHod?.name ?? "",
        hasSubDepartments,
        secondaryDepartments,
      };
      const res = await fetch("/api/college/departments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed");
      }
      toast({ variant: "success", title: "Department updated" });
      router.push("/principal/departments");
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setIsSubmitting(false);
    }
  };

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

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Assign HOD</Label>
                <CreateHodDialog department={department?.name} onCreated={handleHodCreated} />
              </div>
              {hods.length > 0 ? (
                <Select
                  value={hodUid || "none"}
                  onValueChange={(v) => setValue("hodUid", v === "none" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select HOD (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">- No HOD -</SelectItem>
                    {hods.map((h) => {
                      const hDepts = h.departments && h.departments.length > 0 ? h.departments : (h.department ? [h.department] : []);
                      return (
                        <SelectItem key={h.uid} value={h.uid}>
                          {h.name} {hDepts.length > 0 ? `(${hDepts.join(", ")})` : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">
                  No HODs yet - create one above
                </p>
              )}
              {/* An HOD can now head more than one department at once - if the
                  one selected already runs others, say so up front: picking
                  them here ADDS this department to their portfolio, it never
                  evicts them from the rest. */}
              {(() => {
                if (!hodUid) return null;
                const selectedHod = hods.find((h) => h.uid === hodUid);
                if (!selectedHod) return null;
                const hDepts = selectedHod.departments && selectedHod.departments.length > 0
                  ? selectedHod.departments
                  : (selectedHod.department ? [selectedHod.department] : []);
                const otherDepts = hDepts.filter((n) => n !== department?.name);
                if (otherDepts.length === 0) return null;
                return (
                  <p className="text-xs text-muted-foreground rounded-md border p-2.5">
                    {selectedHod.name} is also HOD of <strong className="text-foreground">{otherDepts.join(", ")}</strong> -
                    saving here adds {department?.name ?? "this department"} to their portfolio without removing the rest.
                  </p>
                );
              })()}
            </div>

            <YearsTaughtAndSecondaryFields
              showYears={false}
              openYears={[]}
              onAddYear={() => {}}
              isAddingYear={false}
              assignedYears={[]}
              onToggleYear={() => {}}
              yearsHelperText=""
              secondaryDepartmentOptions={allDepartments.filter((d) => d.id !== department?.id && !d.parentDepartmentId)}
              secondaryDepartments={secondaryDepartments}
              onToggleSecondaryDepartment={toggleSecondaryDepartment}
            />

            {!department?.parentDepartmentId && (
              <div className="flex items-start gap-2 rounded-md border p-3">
                <Checkbox
                  id="dept-has-subdepts"
                  checked={hasSubDepartments}
                  onCheckedChange={(v) => setHasSubDepartments(v === true)}
                />
                <div className="space-y-1">
                  <Label htmlFor="dept-has-subdepts" className="font-normal">Has sub-departments</Label>
                  <p className="text-xs text-muted-foreground">
                    Enable if this department splits into sub-branches (e.g. Basic Science → BS-Maths, BS-English).
                    The HOD will get a &quot;Sub-Departments&quot; page to add sub-departments and assign sub-HODs.
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={isSubmitting}>Save Changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
