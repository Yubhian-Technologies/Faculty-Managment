"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import type { FinancePayment } from "@/types";

type Status = "PROCESSED" | "VERIFIED";

export default function ProcessPaymentPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const paymentId = params.id;
  const status = (searchParams.get("status") === "VERIFIED" ? "VERIFIED" : "PROCESSED") as Status;

  const [payment, setPayment] = useState<FinancePayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    collegeFetch("/api/college/finance-payments")
      .then((r) => r.json() as Promise<{ payments: FinancePayment[] }>)
      .then((d) => {
        const found = (d.payments ?? []).find((p) => p.id === paymentId);
        if (!found) {
          toast({ variant: "destructive", title: "Payment not found" });
          router.push("/finance/payments");
          return;
        }
        setPayment(found);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load payment" }))
      .finally(() => setLoading(false));
  }, [paymentId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await collegeFetch(`/api/college/finance-payments/${paymentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, paymentReference: reference || undefined }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: `Payment marked as ${status.toLowerCase()}` });
      router.push("/finance/payments");
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setSaving(false);
    }
  }

  const title = status === "PROCESSED" ? "Process Payment" : "Verify Payment";

  if (loading) {
    return (
      <div className="max-w-xl">
        <PageHeader title={title} description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title={title}
        description={payment ? `${payment.payeeName} — ${payment.purpose}` : undefined}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment Reference</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Payment Reference — UTR / cheque number</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. UTR / cheque number" />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving}>Confirm</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
