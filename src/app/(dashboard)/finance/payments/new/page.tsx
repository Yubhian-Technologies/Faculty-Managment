"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { stripLeadingZeros } from "@/lib/utils";
import type { FinancePaymentType } from "@/types";

const TYPE_LABELS: Record<FinancePaymentType, string> = {
  VENDOR: "Vendor",
  STAFF_REIMBURSEMENT: "Staff Reimbursement",
  STUDENT_REFUND: "Student Refund",
};

export default function NewPaymentPage() {
  const router = useRouter();
  const [type, setType] = useState<FinancePaymentType>("VENDOR");
  const [payeeName, setPayeeName] = useState("");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!payeeName || !amount || !purpose) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }
    setSaving(true);
    try {
      const res = await collegeFetch("/api/college/finance-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, payeeName, amount: Number(amount), purpose }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Payment created" });
      router.push("/finance/payments");
    } catch {
      toast({ variant: "destructive", title: "Failed to create payment" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="New Payment"
        description="Create a payment for a vendor, staff reimbursement, or student refund"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Type *</Label>
              <Select value={type} onValueChange={(v) => setType(v as FinancePaymentType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_LABELS) as FinancePaymentType[]).map((t) => (
                    <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Payee Name *</Label>
              <Input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Amount *</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(stripLeadingZeros(e.target.value))} />
            </div>

            <div className="space-y-2">
              <Label>Purpose *</Label>
              <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving}>Create Payment</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
