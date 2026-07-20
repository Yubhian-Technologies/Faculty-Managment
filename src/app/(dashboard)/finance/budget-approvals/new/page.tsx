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
import { collegeFetch } from "@/lib/api/collegeFetch";
import { stripLeadingZeros } from "@/lib/utils";

export default function NewBudgetRequestPage() {
  const router = useRouter();
  const [department, setDepartment] = useState("");
  const [requestedAmount, setRequestedAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [justification, setJustification] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!department || !requestedAmount || !purpose) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }
    setSaving(true);
    try {
      const res = await collegeFetch("/api/college/finance-budget-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department, requestedAmount: Number(requestedAmount), purpose, justification }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Budget request logged" });
      router.push("/finance/budget-approvals");
    } catch {
      toast({ variant: "destructive", title: "Failed to log request" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Log Budget Request"
        description="Log a budget request received from a department"
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
              <Label>Requested Amount *</Label>
              <Input type="number" value={requestedAmount} onChange={(e) => setRequestedAmount(stripLeadingZeros(e.target.value))} />
            </div>

            <div className="space-y-2">
              <Label>Purpose *</Label>
              <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. New lab equipment" />
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
