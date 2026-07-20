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
import type { FinanceFundAllocation } from "@/types";

export default function EditFundAllocationPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const allocationId = params.id;

  const [allocation, setAllocation] = useState<FinanceFundAllocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [remainingAmount, setRemainingAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    collegeFetch("/api/college/finance-fund-allocations")
      .then((r) => r.json() as Promise<{ allocations: FinanceFundAllocation[] }>)
      .then((d) => {
        const found = (d.allocations ?? []).find((a) => a.id === allocationId);
        if (!found) {
          toast({ variant: "destructive", title: "Allocation not found" });
          router.push("/finance/fund-allocation");
          return;
        }
        setAllocation(found);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load allocation" }))
      .finally(() => setLoading(false));
  }, [allocationId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!remainingAmount || !reason) {
      toast({ variant: "destructive", title: "Remaining amount and reason required" });
      return;
    }
    setSaving(true);
    try {
      const res = await collegeFetch(`/api/college/finance-fund-allocations/${allocationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remainingAmount: Number(remainingAmount), reason }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Allocation modified" });
      router.push("/finance/fund-allocation");
    } catch {
      toast({ variant: "destructive", title: "Failed to modify allocation" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Modify Allocation" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title={`Modify Allocation — ${allocation?.targetName ?? ""}`}
        description="Adjust the remaining amount for this allocation"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modification Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {allocation && (
              <p className="text-sm text-muted-foreground">
                Current remaining amount: {formatCurrency(allocation.remainingAmount)}
              </p>
            )}

            <div className="space-y-2">
              <Label>New Remaining Amount *</Label>
              <Input type="number" value={remainingAmount} onChange={(e) => setRemainingAmount(stripLeadingZeros(e.target.value))} />
            </div>

            <div className="space-y-2">
              <Label>Reason *</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving}>Save</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
