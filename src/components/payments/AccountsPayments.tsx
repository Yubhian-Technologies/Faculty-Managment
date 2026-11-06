"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, KeyRound, RefreshCw, Undo2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { downloadCSV, toCSV } from "@/lib/utils/csv";
import { PAYMENT_STATUS_CLASS, PAYMENT_STATUS_LABEL } from "./payOnline";
import type { CcavenueSettingsView, Payment, PaymentStatus } from "@/types";

// Accounts (location) > Payments: for each college of the location - its CCAvenue account (the
// Working Key is write-only), its online payments (filters, Excel/CSV export for reconciliation),
// status checks and refunds through CCAvenue's API (only when the static-IP proxy is set up - those
// are the only calls that use it), or recording a refund made in the CCAvenue dashboard.

const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm";
const STATUSES: PaymentStatus[] = ["SUCCESS", "INITIATED", "FAILED", "ABORTED", "REFUNDED", "PARTIALLY_REFUNDED"];

export function AccountsPayments() {
  const [colleges, setColleges] = useState<{ id: string; name: string }[] | null>(null);
  const [collegeId, setCollegeId] = useState("");
  const [proxyConfigured, setProxyConfigured] = useState(false);
  useEffect(() => {
    fetch("/api/college/payments/colleges").then((r) => r.json() as Promise<{ colleges?: { id: string; name: string }[] }>)
      .then((d) => { const list = d.colleges ?? []; setColleges(list); if (list.length === 1) setCollegeId(list[0].id); }).catch(() => setColleges([]));
  }, []);

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="Payments" description="Online fee payments through CCAvenue - one merchant account per college." />
      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="pay-college">College</Label>
        <select id="pay-college" className={`${selectClass} w-full`} value={collegeId} onChange={(e) => setCollegeId(e.target.value)}>
          <option value="">{colleges === null ? "Loading..." : colleges.length ? "Select a college" : "No colleges in your location"}</option>
          {(colleges ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {collegeId && <><CcavenueCard key={`s-${collegeId}`} collegeId={collegeId} onProxy={setProxyConfigured} /><PaymentsList key={`p-${collegeId}`} collegeId={collegeId} proxyConfigured={proxyConfigured} /></>}
    </div>
  );
}

function CcavenueCard({ collegeId, onProxy }: { collegeId: string; onProxy: (on: boolean) => void }) {
  const [s, setS] = useState<CcavenueSettingsView | null>(null);
  const [secretConfigured, setSecretConfigured] = useState(true);
  const [proxy, setProxy] = useState(false);
  const [form, setForm] = useState({ enabled: false, env: "TEST" as "TEST" | "LIVE", merchantId: "", accessCode: "", workingKey: "" });
  const [apiKeys, setApiKeys] = useState<{ label: string; accessCode: string; workingKey: string; hasWorkingKey: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const qs = `?collegeId=${encodeURIComponent(collegeId)}`;
  useEffect(() => {
    let off = false;
    fetch(`/api/college/payments/settings${qs}`).then((r) => r.json() as Promise<{ settings?: CcavenueSettingsView; secretConfigured?: boolean; proxyConfigured?: boolean; error?: string }>)
      .then((d) => {
        if (off || !d.settings) return;
        setS(d.settings); setSecretConfigured(d.secretConfigured !== false); setProxy(!!d.proxyConfigured); onProxy(!!d.proxyConfigured);
        setForm({ enabled: d.settings.enabled, env: d.settings.env, merchantId: d.settings.merchantId, accessCode: d.settings.accessCode, workingKey: "" });
        setApiKeys((d.settings.apiKeys ?? []).map((k) => ({ ...k, workingKey: "" })));
      }).catch(() => undefined);
    return () => { off = true; };
  }, [qs, onProxy]);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/college/payments/settings${qs}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, apiKeys: apiKeys.map((k) => ({ label: k.label, accessCode: k.accessCode, workingKey: k.workingKey })) }) });
      const d = (await res.json()) as { settings?: CcavenueSettingsView; error?: string };
      if (!res.ok || !d.settings) throw new Error(d.error ?? "Couldn't save");
      setS(d.settings); setForm((f) => ({ ...f, workingKey: "" }));
      setApiKeys((d.settings.apiKeys ?? []).map((k) => ({ ...k, workingKey: "" })));
      toast({ variant: "success", title: d.settings.enabled ? "Online payment is on" : "Saved - online payment is off" });
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't save" }); }
    finally { setBusy(false); }
  }

  return (
    <Card className="rounded-2xl"><CardContent className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4" />CCAvenue account</h2>
          <p className="text-xs text-muted-foreground">From the CCAvenue dashboard: Settings &gt; API Keys. The Working Key is stored encrypted and never shown again.{s?.updatedAt ? ` Last saved ${new Date(s.updatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}${s.updatedByName ? ` by ${s.updatedByName}` : ""}.` : ""}</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s?.enabled ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-muted text-muted-foreground"}`}>{s?.enabled ? `On · ${s.env === "LIVE" ? "Live" : "Test"}` : "Off"}</span>
      </div>
      {!secretConfigured && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">The server isn&apos;t set up for payment keys yet (PAYMENT_CONFIG_SECRET). Ask the administrator before entering the Working Key.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5"><Label htmlFor="cc-mid">Merchant ID</Label><Input id="cc-mid" inputMode="numeric" value={form.merchantId} onChange={(e) => setForm({ ...form, merchantId: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="cc-ac">Access Code</Label><Input id="cc-ac" value={form.accessCode} onChange={(e) => setForm({ ...form, accessCode: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="cc-wk">Working Key</Label><Input id="cc-wk" type="password" autoComplete="off" placeholder={s?.hasWorkingKey ? "Saved - type to replace" : "Paste the Working Key"} value={form.workingKey} onChange={(e) => setForm({ ...form, workingKey: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="cc-env">Mode</Label>
          <select id="cc-env" className={`${selectClass} w-full`} value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value as "TEST" | "LIVE" })}>
            <option value="TEST">Test (test.ccavenue.com)</option><option value="LIVE">Live (real payments)</option>
          </select>
        </div>
      </div>
      <div className="space-y-2 rounded-md border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">API keys for the static IPs (optional)</p>
            <p className="text-xs text-muted-foreground">When CCAvenue gives each whitelisted proxy IP its own Access Code and Working Key, enter them here. Status checks and refunds try the key above first, then these.</p>
          </div>
          {apiKeys.length < 5 && <Button size="sm" variant="outline" onClick={() => setApiKeys((k) => [...k, { label: "", accessCode: "", workingKey: "", hasWorkingKey: false }])}>Add key</Button>}
        </div>
        {apiKeys.map((k, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1"><Label htmlFor={`ak-l-${i}`} className="text-xs">IP / label</Label><Input id={`ak-l-${i}`} placeholder="155.121.231.0" value={k.label} onChange={(e) => setApiKeys((cur) => cur.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></div>
            <div className="space-y-1"><Label htmlFor={`ak-c-${i}`} className="text-xs">Access Code</Label><Input id={`ak-c-${i}`} value={k.accessCode} onChange={(e) => setApiKeys((cur) => cur.map((x, j) => (j === i ? { ...x, accessCode: e.target.value } : x)))} /></div>
            <div className="space-y-1"><Label htmlFor={`ak-k-${i}`} className="text-xs">Working Key</Label><Input id={`ak-k-${i}`} type="password" autoComplete="off" placeholder={k.hasWorkingKey ? "Saved - type to replace" : "Paste the Working Key"} value={k.workingKey} onChange={(e) => setApiKeys((cur) => cur.map((x, j) => (j === i ? { ...x, workingKey: e.target.value } : x)))} /></div>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setApiKeys((cur) => cur.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {proxy
          ? "Static IP: on - status checks and refunds go to CCAvenue's API from the whitelisted static IPs. Unfinished payments are also checked every 15 minutes."
          : "Static IP: not set up - check unfinished payments and make refunds in the CCAvenue dashboard, then record refunds here."}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v === true })} />Students can pay online</label>
        <Button size="sm" onClick={() => void save()} loading={busy}>Save</Button>
      </div>
    </CardContent></Card>
  );
}

function PaymentsList({ collegeId, proxyConfigured }: { collegeId: string; proxyConfigured: boolean }) {
  const [checking, setChecking] = useState("");
  async function checkStatus(p: Payment) {
    setChecking(p.id);
    try {
      const res = await fetch(`/api/college/payments/${encodeURIComponent(p.id)}/check?collegeId=${encodeURIComponent(collegeId)}`, { method: "POST" });
      const d = (await res.json()) as { payment?: Payment; changed?: boolean; error?: string };
      if (!res.ok || !d.payment) throw new Error(d.error ?? "Couldn't check");
      toast({ variant: d.changed ? "success" : "default", title: d.changed ? `Now: ${PAYMENT_STATUS_LABEL[d.payment.status]}` : "No change from CCAvenue" });
      setRows((cur) => cur && cur.map((x) => (x.id === p.id ? d.payment! : x)));
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't check" }); }
    finally { setChecking(""); }
  }
  const [rows, setRows] = useState<Payment[] | null>(null);
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [refunding, setRefunding] = useState<Payment | null>(null);
  useEffect(() => {
    let off = false;
    const qs = new URLSearchParams({ collegeId, ...(status ? { status } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) });
    fetch(`/api/college/payments?${qs}`).then((r) => r.json() as Promise<{ payments?: Payment[]; error?: string }>)
      .then((d) => { if (!off) setRows(d.payments ?? []); }).catch(() => { if (!off) setRows([]); });
    return () => { off = true; };
  }, [collegeId, status, from, to, reloadKey]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (rows ?? []).filter((p) => !q || [p.studentName, p.studentRollNumber, p.id, p.trackingId ?? "", p.purpose.label].some((t) => t.toLowerCase().includes(q))), [rows, q]);
  const paid = shown.filter((p) => p.status === "SUCCESS" || p.status === "PARTIALLY_REFUNDED" || p.status === "REFUNDED");
  const total = paid.reduce((n, p) => n + p.amount - (p.refundedAmount ?? 0), 0);
  const flagged = (rows ?? []).filter((p) => p.needsRefund);

  function exportCsv() {
    const header = ["Date", "Order no.", "Student", "Regd. No", "For", "Amount", "Status", "CCAvenue ref", "Bank ref", "Mode", "Refunded", "Note"];
    const body = shown.map((p) => [new Date(p.createdAt).toLocaleString("en-IN"), p.id, p.studentName, p.studentRollNumber, p.purpose.label, String(p.amount), PAYMENT_STATUS_LABEL[p.status], p.trackingId ?? "", p.bankRefNo ?? "", p.paymentMode ?? "", String(p.refundedAmount ?? 0), p.failureMessage ?? ""]);
    downloadCSV(toCSV([header, ...body]), `payments_${from || "all"}_${to || "all"}.csv`);
  }

  return (
    <Card className="rounded-2xl"><CardContent className="space-y-3 p-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label htmlFor="pf-q">Search</Label><Input id="pf-q" className="w-56" placeholder="Student, Regd. No, order, ref" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="pf-s">Status</Label>
          <select id="pf-s" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{PAYMENT_STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="space-y-1"><Label htmlFor="pf-f">From</Label><Input id="pf-f" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="pf-t">To</Label><Input id="pf-t" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!shown.length}><Download className="mr-1.5 h-4 w-4" />Export</Button>
        <p className="ml-auto self-center text-sm">Collected: <b>Rs. {total.toFixed(2)}</b> <span className="text-xs text-muted-foreground">({paid.length} paid)</span></p>
      </div>
      {flagged.length > 0 && (
        <p className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />{flagged.length} payment{flagged.length === 1 ? " was" : "s were"} paid twice for the same fee - refund {flagged.length === 1 ? "it" : "them"} in CCAvenue and record it here.
        </p>
      )}
      {!rows ? <div className="h-40 animate-pulse rounded-lg bg-muted" /> : shown.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No payments.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr>
              <th className="py-1.5 pr-3">Date</th><th className="py-1.5 pr-3">Student</th><th className="py-1.5 pr-3">For</th><th className="py-1.5 pr-3 text-right">Amount</th>
              <th className="py-1.5 pr-3">Status</th><th className="py-1.5 pr-3">CCAvenue ref</th><th className="py-1.5" />
            </tr></thead>
            <tbody className="divide-y">
              {shown.map((p) => (
                <tr key={p.id} className="align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{new Date(p.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}<br /><span className="text-muted-foreground">{p.id}</span></td>
                  <td className="py-1.5 pr-3">{p.studentName}<br /><span className="text-xs text-muted-foreground">{p.studentRollNumber}</span></td>
                  <td className="py-1.5 pr-3">{p.purpose.label}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums" title={p.chargedAmount ? `Student paid Rs. ${p.chargedAmount.toFixed(2)} incl. CCAvenue charges` : undefined}>{p.amount.toFixed(2)}{p.refundedAmount ? <><br /><span className="text-xs text-sky-700">-{p.refundedAmount.toFixed(2)}</span></> : null}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PAYMENT_STATUS_CLASS[p.status]}`}>{PAYMENT_STATUS_LABEL[p.status]}</span>
                    {p.needsRefund && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Needs refund</span>}
                    {p.failureMessage && <p className="mt-0.5 max-w-56 text-[11px] text-muted-foreground">{p.failureMessage}</p>}
                  </td>
                  <td className="py-1.5 pr-3 text-xs">{p.trackingId ?? "-"}{p.bankRefNo ? <><br /><span className="text-muted-foreground">bank {p.bankRefNo}</span></> : null}</td>
                  <td className="py-1.5 whitespace-nowrap">
                    {(p.status === "SUCCESS" || p.status === "PARTIALLY_REFUNDED") && <Button size="sm" variant="outline" onClick={() => setRefunding(p)}><Undo2 className="mr-1 h-3.5 w-3.5" />Refund</Button>}
                    {proxyConfigured && (p.status === "INITIATED" || p.status === "FAILED" || p.status === "ABORTED") && (
                      <Button size="sm" variant="ghost" onClick={() => void checkStatus(p)} loading={checking === p.id} title={p.lastCheckedAt ? `Last checked ${new Date(p.lastCheckedAt).toLocaleString("en-IN")}` : undefined}><RefreshCw className="mr-1 h-3.5 w-3.5" />Check status</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {refunding && <RefundDialog collegeId={collegeId} payment={refunding} proxyConfigured={proxyConfigured} onClose={() => setRefunding(null)} onDone={() => { setRefunding(null); setReloadKey((k) => k + 1); }} />}
    </CardContent></Card>
  );
}

function RefundDialog({ collegeId, payment, proxyConfigured, onClose, onDone }: { collegeId: string; payment: Payment; proxyConfigured: boolean; onClose: () => void; onDone: () => void }) {
  const [via, setVia] = useState<"CCAVENUE" | "RECORDED">(proxyConfigured ? "CCAVENUE" : "RECORDED");
  const left = Math.round((payment.amount - (payment.refundedAmount ?? 0)) * 100) / 100;
  const [amount, setAmount] = useState(String(left));
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState(payment.needsRefund ? "Fee paid twice" : "");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/college/payments/${encodeURIComponent(payment.id)}/refund?collegeId=${encodeURIComponent(collegeId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ via, amount, reference, reason }),
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Couldn't record the refund");
      toast({ variant: "success", title: via === "CCAVENUE" ? "Refunded through CCAvenue - the student is told" : "Refund recorded - the student is told" });
      onDone();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't record the refund" }); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Refund</DialogTitle>
          <DialogDescription>
            {via === "CCAVENUE"
              ? `Order ${payment.id} is refunded now through CCAvenue. Up to Rs. ${left}.`
              : `First refund order ${payment.id} in the CCAvenue dashboard (Orders > Refund), then record it here with CCAvenue's refund reference. Up to Rs. ${left}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {proxyConfigured && (
            <div className="flex flex-col gap-1.5 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="rf-via" checked={via === "CCAVENUE"} onChange={() => setVia("CCAVENUE")} />Refund through CCAvenue now</label>
              <label className="flex items-center gap-2"><input type="radio" name="rf-via" checked={via === "RECORDED"} onChange={() => setVia("RECORDED")} />Already refunded in the CCAvenue dashboard - record it</label>
            </div>
          )}
          <div className="space-y-1.5"><Label htmlFor="rf-a">Amount refunded (Rs.)</Label><Input id="rf-a" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          {via === "RECORDED" && <div className="space-y-1.5"><Label htmlFor="rf-r">CCAvenue refund reference</Label><Input id="rf-r" value={reference} onChange={(e) => setReference(e.target.value)} /></div>}
          <div className="space-y-1.5"><Label htmlFor="rf-why">Reason</Label><Input id="rf-why" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy} disabled={(via === "RECORDED" && !reference.trim()) || !reason.trim()}>{via === "CCAVENUE" ? "Refund now" : "Record refund"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
