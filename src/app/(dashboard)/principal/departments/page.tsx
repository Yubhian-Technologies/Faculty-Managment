"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { departmentSchema, type DepartmentFormData } from "@/lib/validations";
import { toast } from "@/hooks/useToast";
import { yearOrdinalLabel } from "@/lib/college/academicYears";
import type { AcademicYear, Department, FMSUser } from "@/types";

export default function DepartmentsPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [hods, setHods] = useState<FMSUser[]>([]);
  const [openYears, setOpenYears] = useState<AcademicYear[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [deletingDept, setDeletingDept] = useState<Department | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assignedYears, setAssignedYears] = useState<number[]>([]);

  async function loadDepts() {
    setIsLoading(true);
    try {
      const [deptRes, hodRes, yearsRes] = await Promise.all([
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
        fetch("/api/college/users?role=HOD").then((r) => r.json() as Promise<{ users: FMSUser[] }>),
        fetch("/api/college/academic-years").then((r) => r.json() as Promise<{ academicYears: AcademicYear[] }>),
      ]);
      setDepartments(deptRes.departments ?? []);
      setHods(hodRes.users ?? []);
      setOpenYears((yearsRes.academicYears ?? []).filter((y) => y.isActive));
    } catch {
      toast({ variant: "destructive", title: "Failed to load departments" });
    } finally {
      setIsLoading(false);
    }
  }

  function toggleAssignedYear(year: number, checked: boolean) {
    setAssignedYears((prev) => (checked ? [...prev, year].sort() : prev.filter((y) => y !== year)));
  }

  useEffect(() => { void loadDepts(); }, []);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<DepartmentFormData>({
    resolver: zodResolver(departmentSchema),
  });

  function openAdd() {
    reset({ name: "", code: "", hodUid: "" });
    setAssignedYears([]);
    setEditingDept(null);
    setShowForm(true);
  }

  function openEdit(dept: Department) {
    reset({ name: dept.name, code: dept.code, hodUid: dept.hodUid ?? "" });
    setAssignedYears(dept.assignedYears ?? []);
    setEditingDept(dept);
    setShowForm(true);
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
      };

      if (editingDept) {
        const res = await fetch("/api/college/departments", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deptId: editingDept.id, ...payload, assignedYears }),
        });
        if (!res.ok) {
          const json = await res.json() as { error?: string };
          throw new Error(json.error ?? "Failed");
        }
        toast({ variant: "success", title: "Department updated" });
      } else {
        // Create new via API
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
      }

      setShowForm(false);
      await loadDepts();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setIsSubmitting(false);
    }
  };

  async function handleDelete(dept: Department) {
    try {
      const res = await fetch(`/api/college/departments?deptId=${encodeURIComponent(dept.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed");
      }
      toast({ variant: "success", title: "Department removed" });
      setDepartments((prev) => prev.filter((d) => d.id !== dept.id));
    } catch {
      toast({ variant: "destructive", title: "Failed to remove department" });
    } finally {
      setDeletingDept(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Departments"
        description="Manage college departments and assign Heads of Department"
        actions={
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4 mr-2" />
            Add Department
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-lg border bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : departments.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground mb-4">No departments yet. Add your first department to get started.</p>
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4 mr-2" />
              Add Department
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((dept) => (
            <Card
              key={dept.id}
              className={`cursor-pointer transition-colors hover:border-primary/50 ${!dept.isActive ? "opacity-60" : ""}`}
              onClick={() => router.push(`/principal/departments/${dept.id}`)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary" className="text-xs font-mono shrink-0">
                        {dept.code}
                      </Badge>
                      {!dept.isActive && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                    </div>
                    <p className="font-semibold text-sm leading-tight">{dept.name}</p>
                    {dept.hodName ? (
                      <div className="flex items-center gap-1 mt-1.5">
                        <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                        <p className="text-xs text-muted-foreground truncate">HOD: {dept.hodName}</p>
                      </div>
                    ) : (
                      <p className="text-xs text-orange-500 mt-1.5">No HOD assigned</p>
                    )}
                    {dept.assignedYears && dept.assignedYears.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {dept.assignedYears.map((y) => (
                          <Badge key={y} variant="outline" className="text-xs">{yearOrdinalLabel(y)}</Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1.5">No years assigned yet</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => { e.stopPropagation(); openEdit(dept); }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); setDeletingDept(dept); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-primary mt-3">Manage courses &amp; timings →</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{editingDept ? "Edit Department" : "Add Department"}</DialogTitle>
          </DialogHeader>
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
              <Label>Assign HOD</Label>
              {hods.length > 0 ? (
                <Select
                  defaultValue={editingDept?.hodUid ?? ""}
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
                  No HODs yet — create an HOD account first
                </p>
              )}
            </div>

            {editingDept && (
              <div className="space-y-2">
                <Label>Years Taught</Label>
                {openYears.length === 0 ? (
                  <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">
                    No academic years are added for this college yet — ask your Location Admin to add years first.
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
            )}

            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {editingDept ? "Save Changes" : "Add Department"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deletingDept}
        onOpenChange={(open) => !open && setDeletingDept(null)}
        title="Remove Department?"
        description={`"${deletingDept?.name}" will be removed. Existing vacancy requests and candidates linked to this department are NOT affected.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => { if (deletingDept) void handleDelete(deletingDept); }}
      />
    </div>
  );
}
