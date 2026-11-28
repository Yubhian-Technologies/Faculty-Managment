"use client";

import { use, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";

// Public: the page a student's phone opens from the fee counter's QR (lib/fees/counterPay.ts). It shows that one
// payment - college, student, amount - and, while it can still be paid, sends the phone on to CCAvenue (UPI app,
// card, net banking). CCAvenue brings the phone back here, so the same page then shows the result and receipt no.

interface Info {
  state: "READY" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED" | "REFUNDED";
  amount: number; studentName: string; rollNumber: string; label: string; college: string;
  receiptNo?: string | null; trackingId?: string | null; failureMessage?: string | null;
  action?: string; fields?: Record<string, string>;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export default function CounterPayPage({ params, searchParams }: { params: Promise<{ collegeId: string; orderId: string }>; searchParams: Promise<{ k?: string }> }) {
  const { collegeId, orderId } = use(params);
  const { k } = use(searchParams);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [going, setGoing] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    fetch(`/api/public/fee-pay/${encodeURIComponent(collegeId)}/${encodeURIComponent(orderId)}?k=${encodeURIComponent(k ?? "")}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json(); if (!r.ok) setError(d.error ?? "This payment link is not valid."); else setInfo(d as Info); })
      .catch(() => setError("Unable to open this payment. Check the internet connection and scan the QR again."));
  }, [collegeId, orderId, k]);

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-8">
      <div className="mx-auto max-w-md space-y-4 rounded-2xl border bg-background p-6 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fee Payment</p>
        {!info && !error && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Opening the payment…</p>}
        {error && <p className="flex items-start gap-2 text-sm text-red-700"><XCircle className="mt-0.5 h-5 w-5 shrink-0" />{error}</p>}
        {info && (
          <>
            <div className="space-y-1">
              <h1 className="text-lg font-semibold">{info.college}</h1>
              <p className="text-sm text-muted-foreground">{info.studentName} · {info.rollNumber}</p>
              <p className="text-sm text-muted-foreground">{info.label}</p>
            </div>
            <p className="text-3xl font-bold tabular-nums">{inr(info.amount)}</p>

            {info.state === "READY" && info.action && info.fields && (
              <>
                <form ref={form} method="post" action={info.action}>
                  {Object.entries(info.fields).map(([n, v]) => <input key={n} type="hidden" name={n} value={v} />)}
                </form>
                <button type="button" disabled={going} onClick={() => { setGoing(true); form.current?.submit(); }}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-white disabled:opacity-70">
                  {going && <Loader2 className="h-4 w-4 animate-spin" />}Pay {inr(info.amount)}
                </button>
                <p className="text-xs text-muted-foreground">You go to CCAvenue to pay by UPI app, debit or credit card, or net banking, then come back here. The receipt is made as soon as the payment goes through.</p>
              </>
            )}
            {info.state === "PAID" && (
              <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                <CheckCircle2 className="h-6 w-6 shrink-0" />
                <div className="text-sm"><p className="font-semibold">Payment received.</p>{info.receiptNo && <p>Receipt No {info.receiptNo}</p>}{info.trackingId && <p className="text-xs">CCAvenue ref {info.trackingId}</p>}<p className="mt-1 text-xs">The fee counter can print your receipt now.</p></div>
              </div>
            )}
            {info.state === "FAILED" && (
              <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
                <XCircle className="h-6 w-6 shrink-0" />
                <div className="text-sm"><p className="font-semibold">The payment did not go through.</p>{info.failureMessage && <p className="text-xs">{info.failureMessage}</p>}<p className="mt-1 text-xs">No money was taken; if your bank shows a debit, it is returned by the bank. Ask the fee counter for a new QR to try again.</p></div>
              </div>
            )}
            {(info.state === "EXPIRED" || info.state === "CANCELLED" || info.state === "REFUNDED") && (
              <div className="flex items-start gap-3 rounded-xl border p-4 text-sm">
                <Clock className="h-6 w-6 shrink-0 text-muted-foreground" />
                <p>{info.state === "REFUNDED" ? "This payment was refunded." : "This payment link is no longer open. Ask the fee counter for a new QR."}</p>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
