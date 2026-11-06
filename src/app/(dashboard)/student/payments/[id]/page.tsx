"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PAYMENT_STATUS_LABEL } from "@/components/payments/payOnline";
import { toast } from "@/hooks/useToast";
import type { Payment } from "@/types";

// One online payment - where CCAvenue sends the student back after paying.
export default function StudentPaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [p, setP] = useState<Payment | null | undefined>(undefined);
  const [canCheck, setCanCheck] = useState(false);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    fetch("/api/college/payments/my").then((r) => r.json() as Promise<{ payments?: Payment[]; canCheck?: boolean }>)
      .then((d) => { setP((d.payments ?? []).find((x) => x.id === id) ?? null); setCanCheck(!!d.canCheck); }).catch(() => setP(null));
  }, [id]);
  async function checkAgain() {
    setChecking(true);
    try {
      const res = await fetch(`/api/college/payments/my/${encodeURIComponent(id)}/check`, { method: "POST" });
      const d = (await res.json()) as { payment?: Payment; changed?: boolean; error?: string };
      if (!res.ok || !d.payment) throw new Error(d.error ?? "Couldn't check");
      setP(d.payment);
      toast({ variant: d.changed ? "success" : "default", title: d.changed ? "Updated from CCAvenue" : "No change yet - CCAvenue hasn't confirmed it" });
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't check" }); }
    finally { setChecking(false); }
  }

  if (p === undefined) return <div className="h-48 max-w-xl animate-pulse rounded-lg bg-muted" />;
  if (p === null) return <p className="text-sm text-muted-foreground">Payment not found. <Link href="/student/payments" className="text-primary underline">My payments</Link></p>;
  const ok = p.status === "SUCCESS" || p.status === "REFUNDED" || p.status === "PARTIALLY_REFUNDED";
  const Icon = ok ? CheckCircle2 : p.status === "INITIATED" ? Clock : XCircle;
  const rows: [string, string | undefined][] = [
    ["For", p.purpose.label], ["Amount", `Rs. ${p.amount}`], ["Order no.", p.id], ["CCAvenue ref", p.trackingId], ["Bank ref", p.bankRefNo],
    ["Paid by", p.paymentMode], ["Date", new Date(p.settledAt ?? p.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })],
    ...(p.refundedAmount ? [["Refunded", `Rs. ${p.refundedAmount}`] as [string, string]] : []),
  ];
  return (
    <div className="max-w-xl space-y-4">
      <Card><CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-3">
          <Icon className={`h-8 w-8 ${ok ? "text-emerald-600" : p.status === "INITIATED" ? "text-muted-foreground" : "text-red-600"}`} />
          <div>
            <p className="text-lg font-semibold">{ok ? "Payment successful" : p.status === "ABORTED" ? "Payment cancelled" : p.status === "INITIATED" ? "Payment not completed" : "Payment failed"}</p>
            <p className="text-sm text-muted-foreground">{PAYMENT_STATUS_LABEL[p.status]}{!ok && p.failureMessage ? ` · ${p.failureMessage}` : ""}</p>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          {rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium break-all">{v}</dd></div>)}
        </dl>
        {!ok && <p className="text-xs text-muted-foreground">No money is taken for a failed or cancelled payment. If your bank shows a debit, it is reversed by the bank, or checked by the Accounts office.</p>}
      </CardContent></Card>
      <div className="flex gap-2">
        <Button asChild><Link href="/student/certificates">Back to certificates</Link></Button>
        <Button asChild variant="outline"><Link href="/student/payments">My payments</Link></Button>
        {ok && <Button variant="outline" onClick={() => window.print()}>Print receipt</Button>}
        {!ok && canCheck && <Button variant="outline" onClick={() => void checkAgain()} loading={checking}>Check again</Button>}
      </div>
    </div>
  );
}
