"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { PAYMENT_STATUS_CLASS, PAYMENT_STATUS_LABEL } from "@/components/payments/payOnline";
import type { Payment } from "@/types";

// The student's online payments (newest first). ?result=unknown = CCAvenue's answer couldn't be read.
function MyPayments() {
  const params = useSearchParams();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  useEffect(() => {
    fetch("/api/college/payments/my").then((r) => r.json() as Promise<{ payments?: Payment[] }>).then((d) => setPayments(d.payments ?? [])).catch(() => setPayments([]));
  }, []);
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="My payments" description="Fees you have paid online through CCAvenue." />
      {params.get("result") === "unknown" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          The payment result could not be read. If money was debited from your account, the Accounts office will verify and record it; you do not need to pay again. Contact the College Office with the time of payment.
        </p>
      )}
      {!payments ? <div className="h-32 animate-pulse rounded-lg bg-muted" /> : payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No online payments yet.</p>
      ) : (
        <div className="space-y-2">
          {payments.map((p) => (
            <Link key={p.id} href={`/student/payments/${encodeURIComponent(p.id)}`}>
              <Card className="transition-colors hover:border-primary/50"><CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div><p className="font-medium">{p.purpose.label}</p><p className="text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · order {p.id}</p></div>
                <div className="flex items-center gap-2"><span className="font-semibold">₹{p.amount}</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PAYMENT_STATUS_CLASS[p.status]}`}>{PAYMENT_STATUS_LABEL[p.status]}</span></div>
              </CardContent></Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StudentPaymentsPage() {
  return <Suspense fallback={null}><MyPayments /></Suspense>;
}
