"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatCurrency, stripLeadingZeros } from "@/lib/utils";
import type { FinanceBudget } from "@/types";

export default function NewExpenseRequestPage() {
  const router = useRouter();
  const [budgets, setBudgets] = useState<FinanceBudget[]>([]);
  const [department, setDepartment] = useState("");
  const [budgetId, setBudgetId] = useState("");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [justification, setJustification] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    collegeFetch("/api/college/finance-budgets?status=ACTIVE")
      .then((r) => r.json() as Promise<{ budgets: FinanceBudget[] }>)
      .then((d) => setBudgets(d.budgets ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load budgets" }));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!department || !budgetId || !amount || !purpose) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }
    setSaving(true);
    try {
      const res = await collegeFetch("/api/college/finance-expense-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department, budgetId, amount: Number(amount), purpose, justification }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Expense request logged" });
      router.push("/finance/expense-requests");
    } catch {
      toast({ variant: "destructive", title: "Failed to log request" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Log Expense Request"
        description="Log an expenditure request received from a department"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Request Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Department *</Label>
              <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Mechanical Engineering" />
            </div>

            <div className="space-y-2">
              <Label>Budget *</Label>
              <Select value={budgetId} onValueChange={setBudgetId}>
                <SelectTrigger><SelectValue placeholder="Select budget..." /></SelectTrigger>
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
              <Label>Amount *</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(stripLeadingZeros(e.target.value))} />
            </div>

            <div className="space-y-2">
              <Label>Purpose *</Label>
              <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Justification</Label>
              <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving}>Log Request</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
