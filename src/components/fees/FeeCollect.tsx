"use client";

import { useEffect, useState } from "react";
import { Ban, HandCoins, Printer, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { cn, dmy, formatDateTime } from "@/lib/utils";
import { printStudentFeeReceipt } from "@/lib/pdf/studentFeeReceiptTemplate";
import type { InstalmentState } from "@/lib/fees/rules";
import type { FeeReceipt, StudentFeeAccount } from "@/types/fees";
import { feeGet, feeSend, rupee, selectClass, yearChoices, type FeeOptions } from "./feeApi";

// Accounts > Fees > Collect: find a student (Regd. No or name), see their fee account - category, FR / NFR, each
// head (government part, concession, what the student pays, its bank account), instalments (paid / due / overdue +
// late fine) - record a payment taken at the counter (receipt printed, split by bank account) and cancel a receipt.
// Concessions come only from requests Management approved.

interface Hit { id: string; rollNumber: string; name: string; department: string; section: string; balance: number; status: string }
interface College { name: string; place?: string; logoUrl?: string }
interface Detail { account: StudentFeeAccount; instalments: InstalmentState[]; receipts: FeeReceipt[]; college: College; today: string }
const MODES = [["CASH", "Cash"], ["UPI", "UPI"], ["BANK", "Bank Transfer"], ["DD", "Demand Draft"], ["CHEQUE", "Cheque"]] as const;

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
  const [dialog, setDialog] = useState<null | "pay" | { cancel: FeeReceipt }>(null);
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
  const fine = d.instalments.reduce((n, x) => n + x.fine, 0);
  const print = (r: FeeReceipt) => printStudentFeeReceipt({ receipt: r, college: d.college }).catch((e: Error) => toast({ variant: "destructive", title: e.message }));

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold">{a.name} <span className="font-mono text-sm text-muted-foreground">{a.rollNumber}</span></p>
            <p className="text-sm text-muted-foreground">{a.courseName} · {a.department} · Section {a.section} · Batch {a.batch} · {a.academicYear}</p>
            <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
              <Badge variant="outline">{a.category === "A" ? "Category A" : a.category === "B" ? "Category B" : "Spot"}</Badge>
              <Badge variant="outline" className={a.funding === "FR" ? "border-emerald-400 text-emerald-800 dark:text-emerald-300" : ""}>{a.funding === "FR" ? "FR - fee reimbursement" : "NFR - student pays"}</Badge>
              {a.admissionType && <span className="text-muted-foreground">{a.admissionType}</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={a.balance <= 0} onClick={() => setDialog("pay")}><HandCoins className="mr-1 h-4 w-4" />Record Payment</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          <Tile label="Fee" value={rupee(a.gross)} />
          <Tile label="Government (FR)" value={a.govtShare ? `− ${rupee(a.govtShare)}` : "-"} sub={a.govtShare ? `received ${rupee(a.govtReceived)}` : undefined} />
          <Tile label="Concession" value={a.concessionTotal ? `− ${rupee(a.concessionTotal)}` : "-"} sub={a.concessionUnused ? `${rupee(a.concessionUnused)} not used` : undefined} />
          <Tile label="Student Pays" value={rupee(a.studentShare)} />
          <Tile label="Paid" value={rupee(a.paid)} tone="text-emerald-700 dark:text-emerald-300" />
          <Tile label={a.balance < 0 ? "Paid Extra" : "Balance"} value={rupee(Math.abs(a.balance))} tone={a.balance > 0 ? "text-amber-700 dark:text-amber-300" : a.balance < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-300"} sub={fine ? `+ late fine ${rupee(fine)}` : undefined} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium">Instalments</p>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Instalment</th><th className="py-1">Due By</th><th className="py-1 text-right">Amount</th><th className="py-1 text-right">Paid</th><th className="py-1 text-right">Due</th></tr></thead>
              <tbody className="divide-y">{d.instalments.map((x) => (
                <tr key={x.no}>
                  <td className="py-1.5">{x.label}</td>
                  <td className={cn("py-1.5", x.overdue && "font-medium text-destructive")}>{dmy(x.dueDate)}{x.overdue && <span className="block text-[11px]">Overdue{x.fine ? ` · fine ${rupee(x.fine)}` : ""}</span>}</td>
                  <td className="py-1.5 text-right tabular-nums">{rupee(x.amount)}</td>
                  <td className="py-1.5 text-right tabular-nums">{rupee(x.paid)}</td>
                  <td className="py-1.5 text-right font-medium tabular-nums">{x.due ? rupee(x.due) : <span className="text-emerald-700 dark:text-emerald-300">Paid</span>}</td>
                </tr>
              ))}</tbody>
            </table>
            <table className="mt-2 w-full text-xs">
              <thead className="text-left text-muted-foreground"><tr><th className="py-1">Fee Head</th><th className="py-1 text-right">Fee</th><th className="py-1 text-right">Govt</th><th className="py-1 text-right">Concession</th><th className="py-1 text-right">Student</th><th className="py-1 pl-2">Account</th></tr></thead>
              <tbody className="divide-y">{a.heads.map((h) => (
                <tr key={h.headId}><td className="py-1">{h.name}{h.frCovered && <span className="ml-1 text-[10px] text-muted-foreground">FR</span>}</td><td className="py-1 text-right tabular-nums">{rupee(h.amount)}</td><td className="py-1 text-right tabular-nums">{h.govt ? rupee(h.govt) : "-"}</td><td className="py-1 text-right tabular-nums">{h.concession ? rupee(h.concession) : "-"}</td><td className="py-1 text-right font-medium tabular-nums">{rupee(h.student)}</td><td className="py-1 pl-2 text-muted-foreground">{h.bankAccountName || "-"}</td></tr>
              ))}</tbody>
            </table>
            {a.concessions.length > 0 && <p className="text-xs text-muted-foreground">Concessions: {a.concessions.map((c) => `${rupee(c.amount)}${c.headName ? ` on ${c.headName}` : ""} - ${c.reason}${c.referralName ? ` (ref. ${c.referralName})` : ""}, approved by ${c.byName}`).join("; ")}</p>}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Receipts</p>
            {d.receipts.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet.</p> : (
              <ul className="divide-y rounded-md border">{d.receipts.map((r) => (
                <li key={r.id} className={cn("flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm", r.cancelled && "opacity-60")}>
                  <div className="min-w-0">
                    <p><span className="font-medium">{r.receiptNo}</span> · {rupee(r.amount)} {r.cancelled && <Badge variant="outline" className="ml-1 text-[10px] text-destructive">Cancelled</Badge>}</p>
                    <p className="text-xs text-muted-foreground">{dmy(r.paidOn)} · {r.mode}{r.reference ? ` · ${r.reference}` : ""} · {r.byName}{r.cancelled ? ` · cancelled: ${r.cancelled.reason}` : ""}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" aria-label={`Print ${r.receiptNo}`} onClick={() => void print(r)}><Printer className="h-4 w-4" /></Button>
                    {!r.cancelled && r.source === "COUNTER" && <Button size="icon" variant="ghost" aria-label={`Cancel ${r.receiptNo}`} onClick={() => setDialog({ cancel: r })}><Ban className="h-4 w-4" /></Button>}
                  </div>
                </li>
              ))}</ul>
            )}
          </div>
        </div>
        {a.history?.length ? <p className="text-xs text-muted-foreground">Last change: {a.history[a.history.length - 1].action.replace(/_/g, " ").toLowerCase()} by {a.history[a.history.length - 1].byName} on {formatDateTime(new Date(a.history[a.history.length - 1].at))}</p> : null}
      </CardContent>

      {dialog === "pay" && <PayDialog collegeId={collegeId} account={a} today={today} onClose={() => setDialog(null)} onSaved={(r) => { setDialog(null); load(); void print(r); }} />}
      {dialog && typeof dialog === "object" && <CancelDialog collegeId={collegeId} receipt={dialog.cancel} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); load(); }} />}
    </Card>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("text-lg font-semibold tabular-nums", tone)}>{value}</p>{sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}</div>;
}

function PayDialog({ collegeId, account, today, onClose, onSaved }: { collegeId: string; account: StudentFeeAccount; today: string; onClose: () => void; onSaved: (r: FeeReceipt) => void }) {
  const [f, setF] = useState({ amount: String(account.balance), mode: "CASH", reference: "", bank: "", paidOn: today, remarks: "" });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const d = await feeSend<{ receipt: FeeReceipt }>("/api/college/fees/receipts", collegeId, "POST", { accountId: account.id, rev: account.rev, ...f, amount: Number(f.amount) });
      toast({ variant: "success", title: `Payment recorded. Receipt ${d.receipt.receiptNo}.` });
      onSaved(d.receipt);
    } catch (e) { toast({ variant: "destructive", title: (e as Error).message }); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Record Payment</DialogTitle><DialogDescription>{account.name} · {account.rollNumber} · balance {rupee(account.balance)}. The receipt opens for printing once saved.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="pay-amt">Amount (₹)</Label><Input id="pay-amt" type="number" min={1} max={account.balance} step={1} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="pay-mode">Paid By</Label><select id="pay-mode" className={selectClass} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor="pay-ref">{f.mode === "CASH" ? "Reference (optional)" : "Reference (UTR / DD / Cheque No)"}</Label><Input id="pay-ref" value={f.reference} maxLength={80} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="pay-bank">Bank (optional)</Label><Input id="pay-bank" value={f.bank} maxLength={80} onChange={(e) => setF({ ...f, bank: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="pay-on">Paid On</Label><Input id="pay-on" type="date" value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="pay-rem">Remarks (optional)</Label><Input id="pay-rem" value={f.remarks} maxLength={200} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Save and Print Receipt</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
