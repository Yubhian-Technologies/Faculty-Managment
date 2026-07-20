"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { salaryStructureSchema, type SalaryStructureFormData } from "@/lib/validations";
import { toast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/utils";
import { DESIGNATION_LABELS, EMPLOYMENT_TYPE_LABELS, type Designation, type EmploymentType } from "@/types";

const DESIGNATION_OPTIONS = Object.entries(DESIGNATION_LABELS) as [Designation, string][];
const EMPLOYMENT_TYPE_OPTIONS = Object.entries(EMPLOYMENT_TYPE_LABELS) as [EmploymentType, string][];

function computeGrossSalary(data: Partial<SalaryStructureFormData>): number {
  const basic = Number(data.basic) || 0;
  const hraPercent = Number(data.hraPercent) || 0;
  const daPercent = Number(data.daPercent) || 0;
  const ta = Number(data.ta) || 0;
  const medicalAllowance = Number(data.medicalAllowance) || 0;
  const otherAllowances = Number(data.otherAllowances) || 0;
  return basic + (basic * hraPercent) / 100 + (basic * daPercent) / 100 + ta + medicalAllowance + otherAllowances;
}

export default function NewSalaryStructurePage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(salaryStructureSchema),
    defaultValues: {
      name: "",
      designation: "",
      employmentType: "",
      basic: 0,
      hraPercent: 0,
      daPercent: 0,
      ta: 0,
      medicalAllowance: 0,
      otherAllowances: 0,
      employeePfPercent: 0,
      employerPfPercent: 0,
      professionalTax: 0,
      effectiveFrom: new Date().toISOString().slice(0, 10),
    },
  });

  const watched = watch();
  const grossPreview = computeGrossSalary(watched as Partial<SalaryStructureFormData>);

  const onSubmit = async (data: SalaryStructureFormData) => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/college/salary-structures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "Failed");
      }
      toast({ variant: "success", title: "Salary structure added" });
      router.push("/accounts/salary-structures");
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Add Salary Structure"
        description="Define a pay template for a designation & employment type"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Salary Structure Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ss-name">Name *</Label>
              <Input id="ss-name" {...register("name")} placeholder="e.g. Assistant Professor – Permanent 2026" />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Designation *</Label>
                <Select onValueChange={(v) => setValue("designation", v)}>
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
                <Select onValueChange={(v) => setValue("employmentType", v)}>
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
                <Input id="ss-basic" type="number" min={0} {...register("basic")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ss-ta">Transport Allowance</Label>
                <Input id="ss-ta" type="number" min={0} {...register("ta")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ss-hra">HRA %</Label>
                <Input id="ss-hra" type="number" min={0} max={100} {...register("hraPercent")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ss-da">DA %</Label>
                <Input id="ss-da" type="number" min={0} max={100} {...register("daPercent")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ss-medical">Medical Allowance</Label>
                <Input id="ss-medical" type="number" min={0} {...register("medicalAllowance")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ss-other">Other Allowances</Label>
                <Input id="ss-other" type="number" min={0} {...register("otherAllowances")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ss-epf">Employee PF %</Label>
                <Input id="ss-epf" type="number" min={0} max={100} {...register("employeePfPercent")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ss-erpf">Employer PF %</Label>
                <Input id="ss-erpf" type="number" min={0} max={100} {...register("employerPfPercent")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ss-ptax">Professional Tax</Label>
                <Input id="ss-ptax" type="number" min={0} {...register("professionalTax")} />
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

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={isSubmitting}>Add Salary Structure</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
