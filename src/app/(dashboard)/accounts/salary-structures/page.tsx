"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/utils";
import { DESIGNATION_LABELS, EMPLOYMENT_TYPE_LABELS, type SalaryStructure } from "@/types";

export default function SalaryStructuresPage() {
  const router = useRouter();
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleting, setDeleting] = useState<SalaryStructure | null>(null);

  async function loadStructures() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/college/salary-structures").then(
        (r) => r.json() as Promise<{ salaryStructures: SalaryStructure[] }>
      );
      setStructures(res.salaryStructures ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load salary structures" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void loadStructures(); }, []);

  async function handleDelete(s: SalaryStructure) {
    try {
      const res = await fetch(`/api/college/salary-structures?id=${encodeURIComponent(s.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "Failed");
      }
      toast({ variant: "success", title: "Salary structure deactivated" });
      setStructures((prev) => prev.map((item) => (item.id === s.id ? { ...item, isActive: false } : item)));
    } catch {
      toast({ variant: "destructive", title: "Failed to deactivate salary structure" });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Salary Structures"
        description="Define one pay template per designation & employment type. HODs use these to auto-fill Staff Salaries in budget requests."
        actions={
          <Button onClick={() => router.push("/accounts/salary-structures/new")}>
            <Plus className="h-4 w-4 mr-2" />
            Add Salary Structure
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-lg border bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : structures.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground mb-4">No salary structures yet. Add one for each designation to enable auto-fill in budget requests.</p>
            <Button onClick={() => router.push("/accounts/salary-structures/new")}>
              <Plus className="h-4 w-4 mr-2" />
              Add Salary Structure
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {structures.map((s) => (
            <Card key={s.id} className={!s.isActive ? "opacity-60" : ""}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary" className="text-xs shrink-0">{DESIGNATION_LABELS[s.designation]}</Badge>
                      <Badge variant="outline" className="text-xs shrink-0">{EMPLOYMENT_TYPE_LABELS[s.employmentType]}</Badge>
                      {!s.isActive && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                    </div>
                    <p className="font-semibold text-sm leading-tight">{s.name}</p>
                    <p className="text-xs text-muted-foreground mt-1.5">Monthly Gross: {formatCurrency(s.grossSalary)}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push(`/accounts/salary-structures/${s.id}/edit`)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleting(s)}
                      disabled={!s.isActive}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Salary Structure" : "Add Salary Structure"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ss-name">Name *</Label>
              <Input id="ss-name" {...register("name")} placeholder="e.g. Assistant Professor – Permanent 2026" />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Designation *</Label>
                <Select defaultValue={editing?.designation ?? ""} onValueChange={(v) => setValue("designation", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select designation" />
                  </SelectTrigger>
                  <SelectContent>
                    {DESIGNATION_OPTIONS.map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.designation && <p className="text-sm text-destructive">{errors.designation.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Employment Type *</Label>
                <Select defaultValue={editing?.employmentType ?? ""} onValueChange={(v) => setValue("employmentType", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {EMPLOYMENT_TYPE_OPTIONS.map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.employmentType && <p className="text-sm text-destructive">{errors.employmentType.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ss-basic">Basic *</Label>
                <Input id="ss-basic" type="number" min={0} {...register("basic", { valueAsNumber: true })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ss-ta">Transport Allowance</Label>
                <Input id="ss-ta" type="number" min={0} {...register("ta", { valueAsNumber: true })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ss-hra">HRA %</Label>
                <Input id="ss-hra" type="number" min={0} max={100} {...register("hraPercent", { valueAsNumber: true })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ss-da">DA %</Label>
                <Input id="ss-da" type="number" min={0} max={100} {...register("daPercent", { valueAsNumber: true })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ss-medical">Medical Allowance</Label>
                <Input id="ss-medical" type="number" min={0} {...register("medicalAllowance", { valueAsNumber: true })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ss-other">Other Allowances</Label>
                <Input id="ss-other" type="number" min={0} {...register("otherAllowances", { valueAsNumber: true })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ss-epf">Employee PF %</Label>
                <Input id="ss-epf" type="number" min={0} max={100} {...register("employeePfPercent", { valueAsNumber: true })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ss-erpf">Employer PF %</Label>
                <Input id="ss-erpf" type="number" min={0} max={100} {...register("employerPfPercent", { valueAsNumber: true })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ss-ptax">Professional Tax</Label>
                <Input id="ss-ptax" type="number" min={0} {...register("professionalTax", { valueAsNumber: true })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ss-effective">Effective From *</Label>
                <Input id="ss-effective" type="date" {...register("effectiveFrom")} />
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 px-3 py-2 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Monthly Gross Salary (preview)</span>
              <span className="font-semibold">{formatCurrency(grossPreview)}</span>
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {editing ? "Save Changes" : "Add Salary Structure"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Deactivate Salary Structure?"
        description={`"${deleting?.name}" will no longer appear in the budget request Designation dropdown. Existing budget requests already using it are not affected.`}
        confirmLabel="Deactivate"
        variant="destructive"
        onConfirm={() => { if (deleting) void handleDelete(deleting); }}
      />
    </div>
  );
}
