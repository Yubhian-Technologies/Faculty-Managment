"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import type { FeeBankAccount, FeeCategory, FeeHead, FeeSettings } from "@/types/fees";
import { feeGet, feeSend, selectClass } from "./feeApi";

// Accounts > Fees > Setup: the college's bank accounts, the fee heads (each credited to one account), and which fee
// category each admission type belongs to - A (Convenor: FR or NFR), Spot (Category A fee, the student pays),
// B (Management, the student pays).

const CATS: { value: FeeCategory; label: string }[] = [
  { value: "A", label: "Category A (Convenor - FR / NFR)" },
  { value: "SPOT", label: "Spot (Category A fee, student pays)" },
  { value: "B", label: "Category B (Management)" },
];
const mask = (n: string) => (n.length > 4 ? `XXXX${n.slice(-4)}` : n);

export function FeeSetup({ collegeId }: { collegeId: string }) {
  const [banks, setBanks] = useState<FeeBankAccount[] | null>(null);
  const [heads, setHeads] = useState<FeeHead[] | null>(null);
  const [types, setTypes] = useState<{ type: string; students: number; guess: FeeCategory | null }[]>([]);
  const [map, setMap] = useState<Record<string, FeeCategory | "">>({});
  const [bankDraft, setBankDraft] = useState<Partial<FeeBankAccount> | null>(null);
  const [headDraft, setHeadDraft] = useState<{ id?: string; name: string; code: string; bankAccountId: string } | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((n) => n + 1);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [b, h, s] = await Promise.all([
          feeGet<{ accounts: FeeBankAccount[] }>("/api/college/fees/bank-accounts", collegeId),
          feeGet<{ heads: FeeHead[] }>("/api/college/fees/heads", collegeId),
          feeGet<{ settings: FeeSettings; types: { type: string; students: number; guess: FeeCategory | null }[] }>("/api/college/fees/settings", collegeId),
        ]);
        if (!live) return;
        setBanks(b.accounts); setHeads(h.heads); setTypes(s.types.filter((t) => t.type));
        setMap(Object.fromEntries(s.types.filter((t) => t.type).map((t) => [t.type, s.settings.categoryOf[t.type] ?? t.guess ?? ""])));
      } catch (e) { if (live) toast({ variant: "destructive", title: (e as Error).message }); }
    })();
    return () => { live = false; };
  }, [collegeId, tick]);

  async function send(path: string, body: unknown, done: string, method: "POST" = "POST") {
    try { await feeSend(path, collegeId, method, body); toast({ variant: "success", title: done }); return true; }
    catch (e) { toast({ variant: "destructive", title: (e as Error).message }); return false; }
  }
  async function saveMap() {
    try {
      const res = await fetch(`/api/college/fees/settings?collegeId=${encodeURIComponent(collegeId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoryOf: Object.fromEntries(Object.entries(map).filter(([, v]) => v)) }) });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Unable to save the categories.");
      toast({ variant: "success", title: "Categories saved." });
    } catch (e) { toast({ variant: "destructive", title: (e as Error).message }); }
  }
  const bankName = (id?: string | null) => banks?.find((b) => b.id === id)?.name;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div><CardTitle className="text-base">Bank Accounts</CardTitle><CardDescription>The college accounts fees are credited to. Each fee head names one, so every payment is split by account on the receipt and in the day book.</CardDescription></div>
          <Button size="sm" variant="outline" onClick={() => setBankDraft({ name: "", bank: "", accountNo: "", ifsc: "" })}><Plus className="mr-1 h-4 w-4" />Add Bank Account</Button>
        </CardHeader>
        <CardContent>
          {banks === null ? <div className="h-10 animate-pulse rounded bg-muted" /> : banks.length === 0 ? <p className="text-sm text-muted-foreground">No bank accounts yet.</p> : (
            <ul className="divide-y rounded-md border">{banks.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span><span className={b.active ? "font-medium" : "font-medium text-muted-foreground line-through"}>{b.name}</span> <span className="text-muted-foreground">· {b.bank} · {mask(b.accountNo)} · {b.ifsc}</span></span>
                <span className="flex gap-2">
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => setBankDraft(b)}>Edit</button>
                  <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={async () => { if (await send("/api/college/fees/bank-accounts", { ...b, active: !b.active }, b.active ? "Account turned off." : "Account turned on.")) reload(); }}>{b.active ? "Turn Off" : "Turn On"}</button>
                </span>
              </li>
            ))}</ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div><CardTitle className="text-base">Fee Heads</CardTitle><CardDescription>The parts a fee is made of, each credited to a bank account. Turn a head off instead of deleting it.</CardDescription></div>
          <Button size="sm" variant="outline" disabled={!banks?.length} onClick={() => setHeadDraft({ name: "", code: "", bankAccountId: banks?.find((b) => b.active)?.id ?? "" })}><Plus className="mr-1 h-4 w-4" />Add Fee Head</Button>
        </CardHeader>
        <CardContent>
          {heads === null ? <div className="h-10 animate-pulse rounded bg-muted" /> : heads.length === 0 ? <p className="text-sm text-muted-foreground">No fee heads yet. Add the bank accounts first, then Tuition Fee, Special Fee ...</p> : (
            <ul className="divide-y rounded-md border">{heads.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span><span className={h.active ? "font-medium" : "font-medium text-muted-foreground line-through"}>{h.name}</span> <span className="font-mono text-xs text-muted-foreground">{h.code}</span></span>
                <span className="flex items-center gap-3">
                  {bankName(h.bankAccountId) ? <span className="text-xs">→ {bankName(h.bankAccountId)}</span> : <Badge variant="outline" className="border-amber-400 text-[10px] text-amber-800 dark:text-amber-300">No bank account</Badge>}
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => setHeadDraft({ id: h.id, name: h.name, code: h.code, bankAccountId: h.bankAccountId ?? "" })}>Edit</button>
                  <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={async () => { if (await send("/api/college/fees/heads", { id: h.id, name: h.name, code: h.code, active: !h.active }, h.active ? "Fee head turned off." : "Fee head turned on.")) reload(); }}>{h.active ? "Turn Off" : "Turn On"}</button>
                </span>
              </li>
            ))}</ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fee Categories</CardTitle>
          <CardDescription>Which category each admission type on the student records belongs to. Category A students are FR or NFR (set by the Scholarship Cell); Spot students pay the Category A fee themselves; Category B students pay the Category B fee.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {types.length === 0 ? <p className="text-sm text-muted-foreground">No admission types on the student records yet.</p> : (
            <div className="space-y-2">{types.map((t) => (
              <div key={t.type} className="grid items-center gap-2 sm:grid-cols-[1fr_20rem]">
                <span className="text-sm"><span className="font-medium">{t.type}</span> <span className="text-xs text-muted-foreground">({t.students} students)</span></span>
                <select className={selectClass} value={map[t.type] ?? ""} onChange={(e) => setMap((m) => ({ ...m, [t.type]: e.target.value as FeeCategory | "" }))}>
                  <option value="">Not mapped - fees not raised</option>
                  {CATS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            ))}</div>
          )}
          <div className="flex justify-end"><Button onClick={() => void saveMap()}>Save Categories</Button></div>
        </CardContent>
      </Card>

      {bankDraft && (
        <Dialog open onOpenChange={(o) => { if (!o) setBankDraft(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{bankDraft.id ? "Edit Bank Account" : "Add Bank Account"}</DialogTitle><DialogDescription>The full account number is shown only here; receipts and reports show the last 4 digits.</DialogDescription></DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2"><Label htmlFor="ba-name">Name</Label><Input id="ba-name" value={bankDraft.name ?? ""} maxLength={60} placeholder="College Fee Account" onChange={(e) => setBankDraft({ ...bankDraft, name: e.target.value })} /></div>
              <div className="space-y-1 sm:col-span-2"><Label htmlFor="ba-bank">Bank</Label><Input id="ba-bank" value={bankDraft.bank ?? ""} maxLength={80} onChange={(e) => setBankDraft({ ...bankDraft, bank: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="ba-no">Account Number</Label><Input id="ba-no" inputMode="numeric" value={bankDraft.accountNo ?? ""} maxLength={20} onChange={(e) => setBankDraft({ ...bankDraft, accountNo: e.target.value.replace(/\D/g, "") })} /></div>
              <div className="space-y-1"><Label htmlFor="ba-ifsc">IFSC</Label><Input id="ba-ifsc" value={bankDraft.ifsc ?? ""} maxLength={11} onChange={(e) => setBankDraft({ ...bankDraft, ifsc: e.target.value.toUpperCase() })} /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setBankDraft(null)}>Cancel</Button><Button onClick={async () => { if (await send("/api/college/fees/bank-accounts", bankDraft, "Bank account saved.")) { setBankDraft(null); reload(); } }}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {headDraft && (
        <Dialog open onOpenChange={(o) => { if (!o) setHeadDraft(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>{headDraft.id ? "Edit Fee Head" : "Add Fee Head"}</DialogTitle><DialogDescription>For example Tuition Fee (TUI), Special Fee (SPL).</DialogDescription></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label htmlFor="fh-name">Name</Label><Input id="fh-name" value={headDraft.name} maxLength={60} onChange={(e) => setHeadDraft({ ...headDraft, name: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="fh-code">Code</Label><Input id="fh-code" value={headDraft.code} maxLength={12} onChange={(e) => setHeadDraft({ ...headDraft, code: e.target.value.toUpperCase() })} /></div>
              <div className="space-y-1"><Label htmlFor="fh-bank">Credited To</Label>
                <select id="fh-bank" className={selectClass} value={headDraft.bankAccountId} onChange={(e) => setHeadDraft({ ...headDraft, bankAccountId: e.target.value })}>
                  <option value="">Select a bank account</option>
                  {(banks ?? []).filter((b) => b.active || b.id === headDraft.bankAccountId).map((b) => <option key={b.id} value={b.id}>{b.name} ({mask(b.accountNo)})</option>)}
                </select>
              </div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setHeadDraft(null)}>Cancel</Button><Button onClick={async () => { if (await send("/api/college/fees/heads", headDraft, "Fee head saved.")) { setHeadDraft(null); reload(); } }}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
