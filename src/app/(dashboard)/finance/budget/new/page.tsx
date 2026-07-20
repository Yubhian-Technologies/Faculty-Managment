"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { stripLeadingZeros } from "@/lib/utils";

export default function NewBudgetPage() {
  const router = useRouter();
  const [department, setDepartment] = useState("");
  const [purpose, setPurpose] = useState("");
  const [fiscalYear, setFiscalYear] = useState("");
  const [allocatedAmount, setAllocatedAmount] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!department || !purpose || !fiscalYear || !allocatedAmount) {
      toast({ variant: "destructive", title: "Fill in all fields" });
      return;
    }
    setSaving(true);
    try {
      const res = await collegeFetch("/api/college/finance-budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department, purpose, fiscalYear, allocatedAmount: Number(allocatedAmount) }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Budget created" });
      router.push("/finance/budget");
    } catch {
      toast({ variant: "destructive", title: "Failed to create budget" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="New Budget"
        description="Create a new department budget"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Budget Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Department *</Label>
              <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Computer Science" />
            </div>

            <div className="space-y-2">
              <Label>Purpose *</Label>
              <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Lab equipment & maintenance" />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Financial Year *</Label>
                <Input value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)} placeholder="2026-27" />
              </div>
              <div className="space-y-2">
                <Label>Allocated Amount *</Label>
                <Input type="number" value={allocatedAmount} onChange={(e) => setAllocatedAmount(stripLeadingZeros(e.target.value))} placeholder="500000" />
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving}>Create Budget</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
