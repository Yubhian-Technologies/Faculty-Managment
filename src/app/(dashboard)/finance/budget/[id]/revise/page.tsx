"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatCurrency, stripLeadingZeros } from "@/lib/utils";
import type { FinanceBudget } from "@/types";

export default function ReviseBudgetPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const budgetId = params.id;

  const [budget, setBudget] = useState<FinanceBudget | null>(null);
  const [loading, setLoading] = useState(true);
  const [revisedAmount, setRevisedAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    collegeFetch("/api/college/finance-budgets")
      .then((r) => r.json() as Promise<{ budgets: FinanceBudget[] }>)
      .then((d) => {
        const found = (d.budgets ?? []).find((b) => b.id === budgetId);
        if (!found) {
          toast({ variant: "destructive", title: "Budget not found" });
          router.push("/finance/budget");
          return;
        }
        setBudget(found);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load budget" }))
      .finally(() => setLoading(false));
  }, [budgetId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!revisedAmount || !reason) {
      toast({ variant: "destructive", title: "Revised amount and reason required" });
      return;
    }
    setSaving(true);
    try {
      const res = await collegeFetch(`/api/college/finance-budgets/${budgetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REVISE", revisedAmount: Number(revisedAmount), reason }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Budget revised" });
      router.push("/finance/budget");
    } catch {
      toast({ variant: "destructive", title: "Failed to revise budget" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Revise Budget" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title={`Revise Budget — ${budget?.department ?? ""}`}
        description="Adjust the allocated amount for this budget"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revision Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {budget && (
              <p className="text-sm text-muted-foreground">
                Current allocation: {formatCurrency(budget.allocatedAmount)}
              </p>
            )}

            <div className="space-y-2">
              <Label>Revised Amount *</Label>
              <Input type="number" value={revisedAmount} onChange={(e) => setRevisedAmount(stripLeadingZeros(e.target.value))} />
            </div>

            <div className="space-y-2">
              <Label>Reason *</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving}>Save Revision</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
