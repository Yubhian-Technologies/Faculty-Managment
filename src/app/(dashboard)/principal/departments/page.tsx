"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { yearOrdinalLabel } from "@/lib/college/academicYears";
import type { Department } from "@/types";

export default function DepartmentsPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingDept, setDeletingDept] = useState<Department | null>(null);

  async function loadDepts() {
    setIsLoading(true);
    try {
      const deptRes = await fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>);
      setDepartments(deptRes.departments ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load departments" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void loadDepts(); }, []);

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
          <Button onClick={() => router.push("/principal/departments/new")}>
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
            <Button onClick={() => router.push("/principal/departments/new")}>
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
                      onClick={(e) => { e.stopPropagation(); router.push(`/principal/departments/${dept.id}/edit`); }}
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
