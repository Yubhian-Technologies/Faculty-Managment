"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { stripLeadingZeros } from "@/lib/utils";

export default function NewPurchaseClearancePage() {
  const router = useRouter();
  const [items, setItems] = useState("");
  const [estimatedAmount, setEstimatedAmount] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!items || !estimatedAmount) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/college/finance-purchase-clearance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, estimatedAmount: Number(estimatedAmount) }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to raise request");
      }
      toast({ variant: "success", title: "Purchase clearance request raised" });
      router.push("/hod/purchase-clearance");
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to raise request", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Raise Purchase Clearance Request"
        description="Request clearance to purchase items against your department's budget"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Request Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Items / Purpose *</Label>
              <Textarea value={items} onChange={(e) => setItems(e.target.value)} rows={3} />
            </div>
            <div className="space-y-2">
              <Label>Estimated Amount *</Label>
              <Input
                type="number"
                value={estimatedAmount}
                onChange={(e) => setEstimatedAmount(stripLeadingZeros(e.target.value))}
              />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving}>Raise Request</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
