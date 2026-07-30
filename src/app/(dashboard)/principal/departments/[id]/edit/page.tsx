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
import { departmentSchema, type DepartmentFormData } from "@/lib/validations";
import { toast } from "@/hooks/useToast";
import { yearOrdinalLabel } from "@/lib/college/academicYears";
import type { AcademicYear, Department, FMSUser } from "@/types";

export default function EditDepartmentPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [department, setDepartment] = useState<Department | null>(null);
  const [hods, setHods] = useState<FMSUser[]>([]);
  const [openYears, setOpenYears] = useState<AcademicYear[]>([]);
  const [assignedYears, setAssignedYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addingYear, setAddingYear] = useState(false);

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
        const [deptRes, hodRes, yearsRes] = await Promise.all([
          fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
          fetch("/api/college/users?role=HOD").then((r) => r.json() as Promise<{ users: FMSUser[] }>),
          fetch("/api/college/academic-years").then((r) => r.json() as Promise<{ academicYears: AcademicYear[] }>),
        ]);
        const dept = (deptRes.departments ?? []).find((d) => d.id === id) ?? null;
        if (!dept) {
          toast({ variant: "destructive", title: "Department not found" });
          router.push("/principal/departments");
          return;
        }
        setDepartment(dept);
        setHods(hodRes.users ?? []);
        setOpenYears((yearsRes.academicYears ?? []).filter((y) => y.isActive));
        setAssignedYears(dept.assignedYears ?? []);
        reset({ name: dept.name, code: dept.code, hodUid: dept.hodUid ?? "" });
      } catch {
        toast({ variant: "destructive", title: "Failed to load department" });
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [id, reset, router]);

  function toggleAssignedYear(year: number, checked: boolean) {
    setAssignedYears((prev) => (checked ? [...prev, year].sort() : prev.filter((y) => y !== year)));
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
          assignedYears,
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
        assignedYears,
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
                    <SelectItem value="none">— No HOD —</SelectItem>
                    {hods.map((h) => (
                      <SelectItem key={h.uid} value={h.uid}>
                        {h.name} {h.department ? `(${h.department})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">
                  No HODs yet — create one above
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Years Taught</Label>
                <Button type="button" variant="outline" size="sm" onClick={handleAddYear} loading={addingYear}>
                  + Add Year
                </Button>
              </div>
              {openYears.length === 0 ? (
                <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">
                  No academic years added yet for this college — use &quot;+ Add Year&quot; above.
                </p>
              ) : (
                <div className="flex flex-wrap gap-3 border rounded-md px-3 py-2">
                  {openYears.map((y) => (
                    <label key={y.yearNumber} className="flex items-center gap-1.5 text-sm">
                      <Checkbox
                        checked={assignedYears.includes(y.yearNumber)}
                        onCheckedChange={(checked) => toggleAssignedYear(y.yearNumber, !!checked)}
                      />
                      {yearOrdinalLabel(y.yearNumber)}
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Which years of study this department currently teaches. HODs can only create sections for these years.</p>
            </div>

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
