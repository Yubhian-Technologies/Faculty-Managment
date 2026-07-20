"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatCurrency, stripLeadingZeros } from "@/lib/utils";
import type { FinanceBudget, FinanceAllocationTargetType } from "@/types";

const TARGET_TYPES: FinanceAllocationTargetType[] = ["DEPARTMENT", "PROJECT", "EVENT", "PURCHASE"];

export default function NewFundAllocationPage() {
  const router = useRouter();
  const [budgets, setBudgets] = useState<FinanceBudget[]>([]);
  const [budgetId, setBudgetId] = useState("");
  const [targetType, setTargetType] = useState<FinanceAllocationTargetType>("DEPARTMENT");
  const [targetName, setTargetName] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    collegeFetch("/api/college/finance-budgets?status=ACTIVE")
      .then((r) => r.json() as Promise<{ budgets: FinanceBudget[] }>)
      .then((d) => setBudgets(d.budgets ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load budgets" }));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!budgetId || !targetName || !amount) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }
    setSaving(true);
    try {
      const res = await collegeFetch("/api/college/finance-fund-allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgetId, targetType, targetName, amount: Number(amount) }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error);
      }
      toast({ variant: "success", title: "Funds allocated" });
      router.push("/finance/fund-allocation");
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to allocate funds", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Allocate Funds"
        description="Allocate an approved budget to a department, project, event, or purchase"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Allocation Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Budget *</Label>
              <Select value={budgetId} onValueChange={setBudgetId}>
                <SelectTrigger><SelectValue placeholder={budgets.length === 0 ? "No active budgets" : "Select budget..."} /></SelectTrigger>
                <SelectContent>
                  {budgets.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.department} — {formatCurrency(b.allocatedAmount - b.utilizedAmount)} available
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Allocate To (Type) *</Label>
              <Select value={targetType} onValueChange={(v) => setTargetType(v as FinanceAllocationTargetType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TARGET_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={targetName} onChange={(e) => setTargetName(e.target.value)} placeholder="e.g. Annual Tech Fest" />
            </div>

            <div className="space-y-2">
              <Label>Amount *</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(stripLeadingZeros(e.target.value))} />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving}>Allocate</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
