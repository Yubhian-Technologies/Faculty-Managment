"use client";

import { useEffect, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { Ban, CheckCircle2, ExternalLink, Loader2, Maximize2, Printer, QrCode, Search, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { cn, dmy, formatDateTime } from "@/lib/utils";
import { printStudentFeeReceipt } from "@/lib/pdf/studentFeeReceiptTemplate";
import { rupeesInWords } from "@/lib/pdf/feeReceiptTemplate";
import type { InstalmentState } from "@/lib/fees/rules";
import type { FeeReceipt, StudentFeeAccount } from "@/types/fees";
import { feeGet, feeSend, rupee, selectClass, yearChoices, type FeeOptions } from "./feeApi";

// Fees > Collect (Accounts, and the College Office for its own college): find a student (Regd. No or name), see their
// fee - category, FR / NFR, each head (government part, concession, what the student pays, its bank account),
// instalments - and take a payment: through CCAvenue (a QR the student scans: UPI, card, net banking - the receipt is
// made when CCAvenue confirms, lib/fees/counterPay.ts) or money taken directly (cash, cheque, DD, bank transfer).
// Cancelling a receipt is Accounts only. Concessions come only from requests Management approved.

interface Hit { id: string; rollNumber: string; name: string; department: string; section: string; balance: number; status: string }
interface College { name: string; place?: string; logoUrl?: string }
interface Detail { account: StudentFeeAccount; instalments: InstalmentState[]; receipts: FeeReceipt[]; college: College; today: string; canCancel?: boolean; onlinePay?: boolean }
const MODE_LABEL: Record<string, string> = { CASH: "Cash", UPI: "UPI", BANK: "Bank Transfer", DD: "Demand Draft", CHEQUE: "Cheque", ONLINE: "Online (CCAvenue)" };

export function FeeCollect({ collegeId, options, academicYear, setAcademicYear }: { collegeId: string; options: FeeOptions; academicYear: string; setAcademicYear: (y: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function search() {
    if (q.trim().length < 2) { toast({ variant: "destructive", title: "Type at least 2 characters of the Regd. No or name." }); return; }
    try {
      const d = await feeGet<{ rows: Hit[] }>(`/api/college/fees/accounts?academicYear=${academicYear}&q=${encodeURIComponent(q.trim())}`, collegeId);
      setHits(d.rows.slice(0, 50));
      if (d.rows.length === 1) setOpenId(d.rows[0].id);
    } catch (e) { toast({ variant: "destructive", title: (e as Error).message }); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-32 space-y-1"><Label className="text-xs">Academic Year</Label><select className={selectClass} value={academicYear} onChange={(e) => { setAcademicYear(e.target.value); setHits(null); setOpenId(null); }}>{yearChoices(options.academicYear).map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
        <form className="flex flex-1 items-end gap-2" onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <div className="flex-1 space-y-1"><Label htmlFor="fee-q" className="text-xs">Student</Label><Input id="fee-q" value={q} placeholder="Regd. No or name" onChange={(e) => setQ(e.target.value)} /></div>
          <Button type="submit"><Search className="mr-1 h-4 w-4" />Find</Button>
        </form>
      </div>
      {hits && hits.length !== 1 && (
        <Card><CardContent className="p-0">
          {hits.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No fee account found for {academicYear}. Raise the class&apos;s fees first.</p> : (
            <ul className="divide-y">{hits.map((h) => (
              <li key={h.id}><button type="button" onClick={() => setOpenId(h.id)} className={cn("flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted/40", openId === h.id && "bg-muted/50")}>
                <span><span className="font-medium tabular-nums">{h.rollNumber}</span> {h.name} <span className="text-xs text-muted-foreground">{h.department} · {h.section}</span></span>
                <span className={h.balance > 0 ? "font-medium" : "text-emerald-700 dark:text-emerald-300"}>{h.balance > 0 ? `Due ${rupee(h.balance)}` : "Cleared"}</span>
              </button></li>
            ))}</ul>
          )}
        </CardContent></Card>
      )}
      {openId && <AccountPanel key={openId} collegeId={collegeId} accountId={openId} today={options.today} />}
    </div>
  );
}

export function AccountPanel({ collegeId, accountId, today }: { collegeId: string; accountId: string; today: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [cancel, setCancel] = useState<FeeReceipt | null>(null);
  const [tick, setTick] = useState(0);
  const load = () => setTick((n) => n + 1);
  useEffect(() => {
    let live = true;
    feeGet<Detail>(`/api/college/fees/accounts/${encodeURIComponent(accountId)}`, collegeId)
      .then((x) => { if (live) setD(x); })
      .catch((e: Error) => { if (live) toast({ variant: "destructive", title: e.message }); });
    return () => { live = false; };
  }, [collegeId, accountId, tick]);
  if (!d) return <div className="h-48 animate-pulse rounded-lg bg-muted" />;
  const a = d.account;
  const print = (r: FeeReceipt) => printStudentFeeReceipt({ receipt: r, college: d.college }).catch((e: Error) => toast({ variant: "destructive", title: e.message }));
  const catLabel = a.category === "A" ? (a.funding === "FR" ? "CAT-A (FR)" : "CAT-A (NFR)") : a.category === "SPOT" ? "CAT-A (SPOT)" : "CAT-B (MGT)";
  const last = a.history?.length ? a.history[a.history.length - 1] : null;

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3.5">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary">{a.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}</div>
            <div className="space-y-1">
              <p className="text-lg font-semibold">{a.name} <span className="font-mono text-sm font-normal text-muted-foreground">{a.rollNumber}</span></p>
              <p className="text-sm text-muted-foreground">{a.courseName} · {a.department} · Section {a.section}{a.year ? ` · Year ${a.year}` : ""} · Batch {a.batch} · {a.academicYear}</p>
              <p className="flex flex-wrap gap-1.5 text-xs">
                <Badge variant="outline" className="font-semibold">{catLabel}</Badge>
                <Badge variant="outline" className={a.funding === "FR" ? "border-emerald-400 text-emerald-800 dark:text-emerald-300" : ""}>{a.funding === "FR" ? "FR - government pays" : "NFR - student pays"}</Badge>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-6">
            <Figure label="Student Pays" value={rupee(a.studentShare)} />
            <Figure label="Paid" value={rupee(a.paid)} tone="text-emerald-700 dark:text-emerald-300" />
            <Figure label={a.balance < 0 ? "Paid Extra" : "Balance"} value={rupee(Math.abs(a.balance))} tone={a.balance > 0 ? "text-amber-700 dark:text-amber-300" : a.balance < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-300"} />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[999_1_560px] space-y-4">
          <Card className="rounded-2xl"><CardContent className="space-y-4 p-5">
            <p className="text-[15px] font-semibold">Fee Details</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="Fee" value={rupee(a.gross)} />
              <Tile label="Government (FR)" value={a.govtShare ? `− ${rupee(a.govtShare)}` : "-"} sub={a.govtShare ? `received ${rupee(a.govtReceived)}` : undefined} />
              <Tile label="Concession" value={a.concessionTotal ? `− ${rupee(a.concessionTotal)}` : "-"} sub={a.concessionUnused ? `${rupee(a.concessionUnused)} not used` : undefined} />
              <Tile label="Student Pays" value={rupee(a.studentShare)} />
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Instalment</th><th className="py-1">Due By</th><th className="py-1 text-right">Amount</th><th className="py-1 text-right">Paid</th><th className="py-1 text-right">Due</th></tr></thead>
              <tbody className="divide-y">{d.instalments.map((x) => (
                <tr key={x.no}>
                  <td className="py-1.5">{x.label}</td>
                  <td className={cn("py-1.5", x.overdue && "font-medium text-destructive")}>{x.dueDate ? dmy(x.dueDate) : "Not set yet"}{x.overdue && <span className="block text-[11px]">Overdue</span>}</td>
                  <td className="py-1.5 text-right tabular-nums">{rupee(x.amount)}</td>
                  <td className="py-1.5 text-right tabular-nums">{rupee(x.paid)}</td>
                  <td className="py-1.5 text-right font-medium tabular-nums">{x.due ? rupee(x.due) : <span className="text-emerald-700 dark:text-emerald-300">Paid</span>}</td>
                </tr>
              ))}</tbody>
            </table>
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground"><tr><th className="py-1">Fee Head</th><th className="py-1 text-right">Fee</th><th className="py-1 text-right">Government</th><th className="py-1 text-right">Concession</th><th className="py-1 text-right">Student</th><th className="py-1 pl-3">Credited To</th></tr></thead>
              <tbody className="divide-y">{a.heads.map((h) => (
                <tr key={h.headId}><td className="py-1">{h.name}{h.frCovered && <span className="ml-1 text-[10px] text-muted-foreground">FR</span>}</td><td className="py-1 text-right tabular-nums">{rupee(h.amount)}</td><td className="py-1 text-right tabular-nums">{h.govt ? rupee(h.govt) : "-"}</td><td className="py-1 text-right tabular-nums">{h.concession ? rupee(h.concession) : "-"}</td><td className="py-1 text-right font-medium tabular-nums">{rupee(h.student)}</td><td className="py-1 pl-3 text-muted-foreground">{h.bankAccountName || "-"}</td></tr>
              ))}</tbody>
            </table>
            {a.concessions.length > 0 && <p className="text-xs text-muted-foreground">Concessions: {a.concessions.map((c) => `${rupee(c.amount)}${c.headName ? ` on ${c.headName}` : ""} - ${c.reason}${c.referralName ? ` (ref. ${c.referralName})` : ""}, approved by ${c.byName}`).join("; ")}</p>}
            {last && <p className="text-xs text-muted-foreground">Last change: {last.action.replace(/_/g, " ").toLowerCase()} by {last.byName} on {formatDateTime(new Date(last.at))}</p>}
          </CardContent></Card>

          <Card className="rounded-2xl"><CardContent className="space-y-2 p-5">
            <div className="flex items-baseline justify-between gap-2"><p className="text-[15px] font-semibold">Receipts</p>{d.canCancel === false && <span className="text-xs text-muted-foreground">Accounts can cancel a receipt</span>}</div>
            {d.receipts.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet.</p> : (
              <ul className="divide-y rounded-md border">{d.receipts.map((r) => (
                <li key={r.id} className={cn("flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm", r.cancelled && "opacity-60")}>
                  <div className="min-w-0">
                    <p><span className="font-medium">{r.receiptNo}</span> · {rupee(r.amount)} {r.cancelled && <Badge variant="outline" className="ml-1 text-[10px] text-destructive">Cancelled</Badge>}</p>
                    <p className="text-xs text-muted-foreground">{dmy(r.paidOn)} · {MODE_LABEL[r.mode] ?? r.mode}{r.reference ? ` · ${r.reference}` : ""} · {r.byName}{r.cancelled ? ` · cancelled: ${r.cancelled.reason}` : ""}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => void print(r)}><Printer className="mr-1 h-3.5 w-3.5" />Print</Button>
                    {d.canCancel !== false && !r.cancelled && r.source === "COUNTER" && <Button size="icon" variant="ghost" aria-label={`Cancel ${r.receiptNo}`} onClick={() => setCancel(r)}><Ban className="h-4 w-4" /></Button>}
                  </div>
                </li>
              ))}</ul>
            )}
          </CardContent></Card>
        </div>

        <div className="min-w-0 flex-[1_1_420px]">
          {a.balance > 0
            ? <TakePayment collegeId={collegeId} account={a} today={today} onlinePay={!!d.onlinePay} onSaved={(r) => { load(); if (r) void print(r); }} />
            : <Card className="rounded-2xl"><CardContent className="flex items-center gap-3 p-5 text-emerald-800 dark:text-emerald-300"><CheckCircle2 className="h-6 w-6" /><p className="font-medium">{a.balance < 0 ? `Paid ${rupee(-a.balance)} more than the fee.` : "Fully paid - nothing due."}</p></CardContent></Card>}
        </div>
      </div>

      {cancel && <CancelDialog collegeId={collegeId} receipt={cancel} onClose={() => setCancel(null)} onSaved={() => { setCancel(null); load(); }} />}
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className={cn("text-xl font-bold tabular-nums", tone)}>{value}</p></div>;
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("text-base font-semibold tabular-nums", tone)}>{value}</p>{sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}</div>;
}

const MANUAL: { mode: "CASH" | "CHEQUE" | "DD" | "BANK"; label: string }[] = [
  { mode: "CASH", label: "Cash" }, { mode: "CHEQUE", label: "Cheque" }, { mode: "DD", label: "DD" }, { mode: "BANK", label: "Bank Transfer" },
];

/** The right-hand panel: the amount, then CCAvenue (QR / here) or money taken directly (cash, cheque, DD, transfer). */
function TakePayment({ collegeId, account, today, onlinePay, onSaved }: { collegeId: string; account: StudentFeeAccount; today: string; onlinePay: boolean; onSaved: (r: FeeReceipt | null) => void }) {
  const [amount, setAmount] = useState(String(account.balance));
  const [how, setHow] = useState<"ONLINE" | "CASH" | "CHEQUE" | "DD" | "BANK">(onlinePay ? "ONLINE" : "CASH");
  const [f, setF] = useState({ reference: "", bank: "", paidOn: today, remarks: "", received: "", dated: "" });
  const [busy, setBusy] = useState(false);
  const n = Number(amount);
  const amountOk = Number.isInteger(n) && n > 0 && n <= account.balance;
  const change = how === "CASH" && Number(f.received) > n ? Number(f.received) - n : 0;

  async function saveManual() {
    setBusy(true);
    try {
      const remarks = [f.remarks.trim(), (how === "CHEQUE" || how === "DD") && f.dated ? `${how === "DD" ? "DD" : "Cheque"} dated ${dmy(f.dated)}` : ""].filter(Boolean).join(" · ");
      const d = await feeSend<{ receipt: FeeReceipt }>("/api/college/fees/receipts", collegeId, "POST", { accountId: account.id, rev: account.rev, amount: n, mode: how, reference: f.reference, bank: f.bank, paidOn: f.paidOn, remarks });
      toast({ variant: "success", title: `Payment recorded. Receipt ${d.receipt.receiptNo}.` });
      onSaved(d.receipt);
    } catch (e) { toast({ variant: "destructive", title: (e as Error).message }); }
    finally { setBusy(false); }
  }

  const refLabel = how === "CHEQUE" ? "Cheque No" : how === "DD" ? "DD No" : how === "BANK" ? "UTR / Transaction Reference" : "Reference (optional)";
  return (
    <Card className="rounded-2xl border-2 border-primary/70"><CardContent className="space-y-4 p-5">
      <p className="text-lg font-bold">Take Payment</p>
      <div className="space-y-2">
        <Label htmlFor="tp-amt" className="font-semibold">Amount</Label>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={n === account.balance ? "default" : "outline"} className="rounded-full" onClick={() => setAmount(String(account.balance))}>Full Balance {rupee(account.balance)}</Button>
        </div>
        <Input id="tp-amt" type="number" min={1} max={account.balance} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} className="h-12 text-2xl font-bold" />
        <p className="text-xs text-muted-foreground">{amountOk ? `${rupeesInWords(n)} · balance after this ${rupee(account.balance - n)}` : `Enter whole rupees, at most ${rupee(account.balance)}.`}</p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold">Paid By</p>
        {onlinePay && (
          <button type="button" onClick={() => setHow("ONLINE")} className={cn("flex w-full flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-3 py-3 text-sm font-bold", how === "ONLINE" ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted")}>
            Pay Online through CCAvenue<span className="text-xs font-medium">UPI · Debit / Credit Card · Net Banking · Wallets</span>
          </button>
        )}
        <p className="text-xs text-muted-foreground">{onlinePay ? "Or record money taken directly:" : "Online payment is off for this college. Record money taken directly:"}</p>
        <div className="grid grid-cols-4 gap-1.5">
          {MANUAL.map((m) => (
            <button key={m.mode} type="button" onClick={() => setHow(m.mode)} className={cn("h-11 rounded-lg border text-xs font-medium", how === m.mode ? "border-2 border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>{m.label}</button>
          ))}
        </div>
      </div>

      {how === "ONLINE" ? (
        <OnlinePay key={`${account.id}-${account.rev}`} collegeId={collegeId} account={account} amount={n} amountOk={amountOk} onPaid={(r) => onSaved(r)} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {how === "CASH" && <div className="space-y-1"><Label htmlFor="tp-rec">Cash Received (optional)</Label><Input id="tp-rec" type="number" min={0} step={1} value={f.received} onChange={(e) => setF({ ...f, received: e.target.value })} />{change > 0 && <p className="text-xs font-medium text-amber-700">Give back {rupee(change)}</p>}</div>}
            <div className="space-y-1"><Label htmlFor="tp-ref">{refLabel}</Label><Input id="tp-ref" value={f.reference} maxLength={80} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
            {how !== "CASH" && <div className="space-y-1"><Label htmlFor="tp-bank">{how === "BANK" ? "Payer's Bank" : "Bank and Branch"}</Label><Input id="tp-bank" value={f.bank} maxLength={80} onChange={(e) => setF({ ...f, bank: e.target.value })} /></div>}
            {(how === "CHEQUE" || how === "DD") && <div className="space-y-1"><Label htmlFor="tp-dated">Date on the {how === "DD" ? "DD" : "Cheque"}</Label><Input id="tp-dated" type="date" value={f.dated} onChange={(e) => setF({ ...f, dated: e.target.value })} /></div>}
            <div className="space-y-1"><Label htmlFor="tp-on">Paid On</Label><Input id="tp-on" type="date" value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></div>
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="tp-rem">Remarks (optional)</Label><Input id="tp-rem" value={f.remarks} maxLength={160} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></div>
          </div>
          {(how === "CHEQUE" || how === "DD") && <p className="text-xs text-muted-foreground">The receipt says &quot;subject to realisation&quot;. If it bounces, Accounts cancels the receipt.</p>}
          <Button className="h-12 w-full text-base font-bold" loading={busy} disabled={!amountOk || (how !== "CASH" && !f.reference.trim())} onClick={() => void saveManual()}>
            Save and Print Receipt{amountOk ? ` · ${rupee(n)}` : ""}
          </Button>
        </>
      )}
    </CardContent></Card>
  );
}

interface CounterStatus { state: "READY" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED" | "REFUNDED"; receipt: FeeReceipt | null; paymentMode: string | null; failureMessage: string | null; needsRefund: boolean }

/** CCAvenue at the counter: a QR for this one payment, then wait until CCAvenue confirms it - the receipt is made by itself. */
function OnlinePay({ collegeId, account, amount, amountOk, onPaid }: { collegeId: string; account: StudentFeeAccount; amount: number; amountOk: boolean; onPaid: (r: FeeReceipt | null) => void }) {
  const [order, setOrder] = useState<{ orderId: string; payUrl: string; expiresAt: string; amount: number } | null>(null);
  const [status, setStatus] = useState<CounterStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [big, setBig] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    if (!order) return;
    let live = true;
    const t = setInterval(() => {
      feeGet<CounterStatus>(`/api/college/fees/counter-payment?orderId=${encodeURIComponent(order.orderId)}`, collegeId)
        .then((s) => {
          if (!live) return;
          setStatus(s);
          if (s.state === "PAID" && !done.current) { done.current = true; setBig(false); toast({ variant: "success", title: `Payment received${s.receipt ? `. Receipt ${s.receipt.receiptNo}` : ""}.` }); onPaid(s.receipt); }
        })
        .catch(() => undefined);
    }, 4000);
    return () => { live = false; clearInterval(t); };
  }, [order, collegeId, onPaid]);

  async function start() {
    setBusy(true);
    try {
      const o = await feeSend<{ orderId: string; payUrl: string; expiresAt: string; amount: number }>("/api/college/fees/counter-payment", collegeId, "POST", { action: "start", accountId: account.id, amount });
      done.current = false; setStatus(null); setOrder(o);
    } catch (e) { toast({ variant: "destructive", title: (e as Error).message }); }
    finally { setBusy(false); }
  }
  async function stop() {
    if (!order) return;
    try { await feeSend("/api/college/fees/counter-payment", collegeId, "POST", { action: "cancel", orderId: order.orderId }); } catch (e) { toast({ variant: "destructive", title: (e as Error).message }); }
    setOrder(null); setStatus(null);
  }

  if (!order) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Creates a CCAvenue payment for this student and shows a QR. The student scans it with their phone and pays by UPI, card or net banking; the receipt is made as soon as CCAvenue confirms. Valid 30 minutes.</p>
        <Button className="h-12 w-full text-base font-bold" loading={busy} disabled={!amountOk} onClick={() => void start()}><QrCode className="mr-2 h-5 w-5" />Show QR to Pay{amountOk ? ` · ${rupee(amount)}` : ""}</Button>
      </div>
    );
  }
  const state = status?.state ?? "READY";
  const svg = qrSvg(order.payUrl);
  return (
    <div className="space-y-3">
      {state === "READY" && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-muted/30 p-3">
          <div className="h-40 w-40 shrink-0 rounded-lg border bg-white p-2 [&>svg]:h-full [&>svg]:w-full" role="img" aria-label={`QR to pay ${rupee(order.amount)}`} dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="min-w-0 flex-1 space-y-1.5 text-sm">
            <p className="font-semibold">Student scans to pay {rupee(order.amount)}</p>
            <p className="text-xs text-muted-foreground">UPI app, card or net banking on CCAvenue. Valid till {new Date(order.expiresAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}. Order {order.orderId}</p>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={() => setBig(true)}><Maximize2 className="mr-1 h-3.5 w-3.5" />Show Full Screen</Button>
              <Button size="sm" variant="outline" onClick={() => window.open(order.payUrl, "_blank", "noopener")}><ExternalLink className="mr-1 h-3.5 w-3.5" />Open Checkout Here</Button>
            </div>
          </div>
        </div>
      )}
      <div className={cn("flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm", state === "PAID" && "border-emerald-300 bg-emerald-50 text-emerald-900", state === "FAILED" && "border-red-300 bg-red-50 text-red-900")}>
        {state === "READY" && <><Loader2 className="h-4 w-4 animate-spin text-amber-600" /><b>Waiting for payment…</b><span className="text-muted-foreground">checking every few seconds</span></>}
        {state === "PAID" && <><CheckCircle2 className="h-4 w-4" /><b>Paid</b>{status?.receipt && <span>· Receipt {status.receipt.receiptNo}</span>}{status?.paymentMode && <span>· {status.paymentMode}</span>}{status?.needsRefund && <span className="text-destructive">· paid twice - refund on Payments</span>}</>}
        {state === "FAILED" && <><XCircle className="h-4 w-4" /><b>The payment did not go through.</b>{status?.failureMessage && <span className="text-xs">{status.failureMessage}</span>}</>}
        {(state === "EXPIRED" || state === "CANCELLED") && <><XCircle className="h-4 w-4 text-muted-foreground" /><b>{state === "EXPIRED" ? "The QR has expired." : "Payment request cancelled."}</b></>}
      </div>
      {state === "READY"
        ? <Button variant="outline" className="w-full" onClick={() => void stop()}>Cancel This Payment Request</Button>
        : state !== "PAID" && <Button className="w-full" onClick={() => { setOrder(null); setStatus(null); }}>Start Again</Button>}
      <Dialog open={big && state === "READY"} onOpenChange={setBig}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Scan to Pay {rupee(order.amount)}</DialogTitle><DialogDescription>{account.name} · {account.rollNumber} · Fees {account.academicYear}</DialogDescription></DialogHeader>
          <div className="mx-auto aspect-square w-full max-w-sm rounded-xl border bg-white p-4 [&>svg]:h-full [&>svg]:w-full" role="img" aria-label={`QR to pay ${rupee(order.amount)}`} dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="text-center text-sm text-muted-foreground">Open the phone camera or any UPI / QR scanner, then pay by UPI, card or net banking.</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The QR as an inline SVG (black on white, margin 2 modules). */
function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function CancelDialog({ collegeId, receipt, onClose, onSaved }: { collegeId: string; receipt: FeeReceipt; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await feeSend(`/api/college/fees/receipts/${encodeURIComponent(receipt.id)}/cancel`, collegeId, "POST", { reason });
      toast({ variant: "success", title: "Receipt cancelled." });
      onSaved();
    } catch (e) { toast({ variant: "destructive", title: (e as Error).message }); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Cancel Receipt {receipt.receiptNo}</DialogTitle><DialogDescription>{rupee(receipt.amount)} comes off what the student paid. The receipt stays in the register, marked cancelled.</DialogDescription></DialogHeader>
        <div className="space-y-1"><Label htmlFor="can-reason">Reason</Label><Input id="can-reason" value={reason} maxLength={300} placeholder="For example: cheque bounced, entered twice" onChange={(e) => setReason(e.target.value)} /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Keep It</Button><Button variant="destructive" loading={busy} disabled={!reason.trim()} onClick={() => void save()}>Cancel Receipt</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
