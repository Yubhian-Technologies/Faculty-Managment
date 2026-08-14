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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { CreateHodDialog } from "@/components/college/CreateHodDialog";
import { YearsTaughtAndSecondaryFields } from "@/components/college/YearsTaughtAndSecondaryFields";
import { departmentSchema, type DepartmentFormData } from "@/lib/validations";
import { toast } from "@/hooks/useToast";
import type { AcademicYear, Department, FMSUser } from "@/types";

export default function NewDepartmentPage() {
  const router = useRouter();
  const [hods, setHods] = useState<FMSUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [secondaryDepartments, setSecondaryDepartments] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubDepartments, setHasSubDepartments] = useState(false);
  const [openYears, setOpenYears] = useState<AcademicYear[]>([]);
  const [assignedYears, setAssignedYears] = useState<number[]>([]);
  const [addingYear, setAddingYear] = useState(false);

  useEffect(() => {
    fetch("/api/college/users?role=HOD")
      .then((r) => r.json() as Promise<{ users: FMSUser[] }>)
      .then((d) => setHods(d.users ?? []))
      .catch(() => {});

    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments((d.departments ?? []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {});

    fetch("/api/college/academic-years")
      .then((r) => r.json() as Promise<{ academicYears: AcademicYear[] }>)
      .then((d) => setOpenYears((d.academicYears ?? []).filter((y) => y.isActive)))
      .catch(() => {});
  }, []);

  function toggleAssignedYear(year: number, checked: boolean) {
    setAssignedYears((prev) => (checked ? [...prev, year] : prev.filter((y) => y !== year)));
  }

  async function handleAddYear() {
    setAddingYear(true);
    try {
      const res = await fetch("/api/college/academic-years", { method: "POST" });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to add year");

      const yearsRes = await fetch("/api/college/academic-years");
      const data = await yearsRes.json() as { academicYears: AcademicYear[] };
      setOpenYears((data.academicYears ?? []).filter((y) => y.isActive));
      toast({ variant: "success", title: "Academic year added" });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to add year" });
    } finally {
      setAddingYear(false);
    }
  }

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<DepartmentFormData>({
    resolver: zodResolver(departmentSchema),
    defaultValues: { name: "", code: "", hodUid: "" },
  });

  const hodUid = watch("hodUid");
  const nameValue = watch("name");

  async function handleHodCreated(uid: string) {
    try {
      const res = await fetch("/api/college/users?role=HOD");
      const data = await res.json() as { users: FMSUser[] };
      setHods(data.users ?? []);
    } catch {
      toast({ variant: "destructive", title: "Created, but failed to refresh HOD list" });
    }
    setValue("hodUid", uid);
  }

  function toggleSecondaryDepartment(name: string, checked: boolean) {
    setSecondaryDepartments((prev) => (checked ? [...prev, name] : prev.filter((n) => n !== name)));
  }

  const onSubmit = async (data: DepartmentFormData) => {
    setIsSubmitting(true);
    try {
      const selectedHod = hods.find((h) => h.uid === data.hodUid);
      const payload = {
        name: data.name,
        code: data.code.toUpperCase(),
        hodUid: data.hodUid ?? "",
        hodName: selectedHod?.name ?? "",
        hasSubDepartments,
        secondaryDepartments: secondaryDepartments.length > 0 ? secondaryDepartments : undefined,
        assignedYears: assignedYears.length > 0 ? assignedYears : undefined,
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
        description="Add a new department and optionally assign a Head of Department"
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
                <CreateHodDialog department={nameValue || undefined} onCreated={handleHodCreated} />
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
                    {hods.map((h) => (
                      <SelectItem key={h.uid} value={h.uid}>
                        {h.name} {h.department ? `(${h.department})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">
                  No HODs yet - create one above
                </p>
              )}
            </div>

            <YearsTaughtAndSecondaryFields
              openYears={openYears}
              onAddYear={handleAddYear}
              isAddingYear={addingYear}
              assignedYears={assignedYears}
              onToggleYear={toggleAssignedYear}
              yearsHelperText="Which years of study this department currently teaches. HODs can only create sections for these years. A shared first-year department holds just 1st Year; each core branch holds the rest."
              secondaryDepartmentOptions={departments.filter((d) => d.name !== nameValue && !d.parentDepartmentId)}
              secondaryDepartments={secondaryDepartments}
              onToggleSecondaryDepartment={toggleSecondaryDepartment}
            />

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

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={isSubmitting}>Add Department</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
