"use client";

import { useEffect, useState } from "react";
import { FileText, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { cn, formatDateTime } from "@/lib/utils";
import { academicYearOf } from "@/lib/fees/rules";
import type { FeeConcessionRequest } from "@/types/fees";

// College Office > Fees > Concession Requests: ask Management for a fee concession for a student - amount (on a fee
// head or the whole fee), reason, referral name and the letter (PDF). Management approves (the amount or less) or
// rejects; an approved concession is applied to the student's fee at once. A pending request can be withdrawn.

const rupee = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
const STATUS: Record<string, string> = { PENDING: "Waiting for Management", APPROVED: "Approved", REJECTED: "Rejected", WITHDRAWN: "Withdrawn" };
const TONE: Record<string, string> = { PENDING: "border-amber-400 text-amber-800 dark:text-amber-300", APPROVED: "border-emerald-400 text-emerald-800 dark:text-emerald-300", REJECTED: "border-destructive/50 text-destructive", WITHDRAWN: "text-muted-foreground" };
interface Hit { id: string; rollNumber: string; name: string; department: string; section: string; category: string; funding: string; gross: number; concessionTotal: number; studentShare: number; paid: number; heads: { headId: string; name: string; student: number }[] }

function yearOptions(current: string) {
  const s = Number(current.slice(0, 4));
  return [1, 0, -1, -2].map((d) => `${s + d}-${String((s + d + 1) % 100).padStart(2, "0")}`);
}

export default function OfficeConcessionsPage() {
  const current = academicYearOf(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()));
  const [year, setYear] = useState(current);
  const [rows, setRows] = useState<FeeConcessionRequest[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`/api/college/fees/concession-requests?academicYear=${year}`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "Unable to load the requests."); return d.requests as FeeConcessionRequest[]; })
      .then((d) => { if (live) setRows(d); })
      .catch((e: Error) => { if (live) toast({ variant: "destructive", title: e.message }); });
    return () => { live = false; };
  }, [year, tick]);

  async function withdraw(r: FeeConcessionRequest) {
    const res = await fetch(`/api/college/fees/concession-requests/${r.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "WITHDRAW" }) });
    const d = (await res.json()) as { error?: string };
    if (!res.ok) { toast({ variant: "destructive", title: d.error ?? "Unable to withdraw the request." }); return; }
    toast({ title: "Request withdrawn." }); setTick((n) => n + 1);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Fee Concession Requests" description="Ask Management for a fee concession for a student, with the reason, referral and letter. Once approved, it is applied to the student's fee." />
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-32 space-y-1"><Label className="text-xs">Academic Year</Label><select className={selectClass} value={year} onChange={(e) => setYear(e.target.value)}>{yearOptions(current).map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
        <Button className="ml-auto" onClick={() => setAsking(true)}><Plus className="mr-1 h-4 w-4" />New Request</Button>
      </div>
      {rows === null ? <div className="h-32 animate-pulse rounded-lg bg-muted" /> : rows.length === 0 ? <p className="text-sm text-muted-foreground">No concession requests for {year}.</p> : (
        <Card><CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr>{["Student", "Asked", "On", "Reason", "Referral", "Letter", "Status", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y">{rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-3 py-2"><span className="font-medium tabular-nums">{r.rollNumber}</span> {r.name}<span className="block text-xs text-muted-foreground">{r.department} · {r.section} · fee {rupee(r.gross)}</span></td>
                <td className="px-3 py-2 tabular-nums">{rupee(r.amount)}{r.status === "APPROVED" && r.approvedAmount !== r.amount && <span className="block text-xs text-emerald-700 dark:text-emerald-300">approved {rupee(r.approvedAmount ?? 0)}</span>}</td>
                <td className="px-3 py-2 text-xs">{r.headName ?? "Whole fee"}</td>
                <td className="max-w-[220px] px-3 py-2 text-xs">{r.reason}</td>
                <td className="px-3 py-2 text-xs">{r.referralName}{r.referralDetails ? <span className="block text-muted-foreground">{r.referralDetails}</span> : null}</td>
                <td className="px-3 py-2"><a href={r.letterUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><FileText className="h-3.5 w-3.5" />View</a></td>
                <td className="px-3 py-2"><Badge variant="outline" className={cn("text-[10px]", TONE[r.status])}>{STATUS[r.status]}</Badge>
                  <span className="block text-[11px] text-muted-foreground">{r.decidedAt ? `${r.decidedByName} · ${formatDateTime(new Date(r.decidedAt))}` : `${r.requestedByName} · ${formatDateTime(new Date(r.requestedAt))}`}</span>
                  {r.remarks && <span className="block text-[11px]">{r.remarks}</span>}
                </td>
                <td className="px-3 py-2 text-right">{r.status === "PENDING" && <Button size="sm" variant="ghost" onClick={() => void withdraw(r)}>Withdraw</Button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </CardContent></Card>
      )}
      {asking && <NewRequestDialog year={year} onClose={() => setAsking(false)} onSaved={() => { setAsking(false); setTick((n) => n + 1); }} />}
    </div>
  );
}

function NewRequestDialog({ year, onClose, onSaved }: { year: string; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [pick, setPick] = useState<Hit | null>(null);
  const [f, setF] = useState({ amount: "", headId: "", reason: "", referralName: "", referralDetails: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function find() {
    const res = await fetch(`/api/college/fees/concession-requests?academicYear=${year}&q=${encodeURIComponent(q.trim())}`);
    const d = (await res.json()) as { accounts?: Hit[]; error?: string };
    if (!res.ok) { toast({ variant: "destructive", title: d.error ?? "Unable to find the student." }); return; }
    setHits(d.accounts ?? []); if (d.accounts?.length === 1) setPick(d.accounts[0]);
  }
  async function save() {
    if (!pick || !file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("accountId", pick.id);
      Object.entries(f).forEach(([k, v]) => form.set(k, v));
      form.set("letter", file);
      const res = await fetch("/api/college/fees/concession-requests", { method: "POST", body: form });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Unable to send the request.");
      toast({ variant: "success", title: "Request sent to Management." });
      onSaved();
    } catch (e) { toast({ variant: "destructive", title: (e as Error).message }); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>New Concession Request</DialogTitle><DialogDescription>{year} fees. Management is told at once; the concession is applied once they approve.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          {!pick ? (
            <div className="space-y-2">
              <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void find(); }}>
                <div className="flex-1 space-y-1"><Label htmlFor="cr-q">Student</Label><Input id="cr-q" value={q} placeholder="Regd. No or name" onChange={(e) => setQ(e.target.value)} /></div>
                <Button type="submit" variant="outline"><Search className="mr-1 h-4 w-4" />Find</Button>
              </form>
              {hits && (hits.length === 0 ? <p className="text-sm text-muted-foreground">No fee account found for {year}. Fees must be raised for the student first.</p> : (
                <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">{hits.map((h) => (
                  <li key={h.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted/40" onClick={() => setPick(h)}><span className="font-medium tabular-nums">{h.rollNumber}</span> {h.name} <span className="text-xs text-muted-foreground">{h.department} · {h.section}</span></button></li>
                ))}</ul>
              ))}
            </div>
          ) : (
            <div className="flex items-start justify-between gap-2 rounded-lg border p-3 text-sm">
              <div><p className="font-medium">{pick.name} <span className="font-mono text-xs text-muted-foreground">{pick.rollNumber}</span></p>
                <p className="text-xs text-muted-foreground">{pick.department} · {pick.section} · {pick.category === "SPOT" ? "Spot" : `Category ${pick.category}`}{pick.category === "A" ? ` ${pick.funding}` : ""} · fee {rupee(pick.gross)} · pays {rupee(pick.studentShare)}{pick.concessionTotal ? ` · concession so far ${rupee(pick.concessionTotal)}` : ""}</p></div>
              <Button size="sm" variant="ghost" onClick={() => { setPick(null); setHits(null); }}>Change</Button>
            </div>
          )}
          {pick && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="cr-amt">Concession (₹)</Label><Input id="cr-amt" type="number" min={1} max={pick.studentShare} step={1} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="cr-head">On</Label><select id="cr-head" className={selectClass} value={f.headId} onChange={(e) => setF({ ...f, headId: e.target.value })}><option value="">Whole fee</option>{pick.heads.filter((h) => h.student > 0).map((h) => <option key={h.headId} value={h.headId}>{h.name} (pays {rupee(h.student)})</option>)}</select></div>
              <div className="space-y-1 sm:col-span-2"><Label htmlFor="cr-reason">Reason</Label><Textarea id="cr-reason" rows={2} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="cr-ref">Referral Name</Label><Input id="cr-ref" maxLength={100} value={f.referralName} onChange={(e) => setF({ ...f, referralName: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="cr-refd">Referral Details (optional)</Label><Input id="cr-refd" maxLength={200} placeholder="Designation, phone" value={f.referralDetails} onChange={(e) => setF({ ...f, referralDetails: e.target.value })} /></div>
              <div className="space-y-1 sm:col-span-2"><Label htmlFor="cr-letter">Letter (PDF, up to 5 MB)</Label><Input id="cr-letter" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
            </div>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!pick || !file || !f.amount || !f.reason.trim() || !f.referralName.trim()} onClick={() => void save()}>Send to Management</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
