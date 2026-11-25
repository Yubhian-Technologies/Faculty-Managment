"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
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
import type { FeeConcessionRequest } from "@/types/fees";

// Management > Fee Concessions: every college's concession requests from the College Office - student, fee, amount
// asked, reason, referral, the letter. Approve (the amount or less; applied to the student's fee at once) or reject
// with a reason.

const rupee = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export default function ManagementFeeConcessionsPage() {
  const [view, setView] = useState<"PENDING" | "DECIDED">("PENDING");
  const [rows, setRows] = useState<FeeConcessionRequest[] | null>(null);
  const [deciding, setDeciding] = useState<{ r: FeeConcessionRequest; action: "APPROVE" | "REJECT" } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`/api/management/fee-concessions?status=${view}`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "Unable to load the requests."); return d.requests as FeeConcessionRequest[]; })
      .then((d) => { if (live) setRows(d); })
      .catch((e: Error) => { if (live) toast({ variant: "destructive", title: e.message }); });
    return () => { live = false; };
  }, [view, tick]);

  return (
    <div className="space-y-6">
      <PageHeader title="Fee Concessions" description="Concession requests from the College Offices. An approved concession is applied to the student's fee at once." />
      <div className="flex gap-1.5">
        {(["PENDING", "DECIDED"] as const).map((v) => (
          <button key={v} type="button" onClick={() => { setRows(null); setView(v); }} className={cn("rounded-full border px-3 py-1 text-xs font-medium", view === v ? "border-foreground bg-foreground text-background" : "bg-card hover:border-primary")}>{v === "PENDING" ? "Waiting for You" : "Decided"}</button>
        ))}
      </div>
      {rows === null ? <div className="h-32 animate-pulse rounded-lg bg-muted" /> : rows.length === 0 ? <p className="text-sm text-muted-foreground">{view === "PENDING" ? "No requests waiting." : "Nothing decided yet."}</p> : (
        <div className="space-y-3">{rows.map((r) => (
          <Card key={`${r.collegeId}/${r.id}`}><CardContent className="flex flex-wrap items-start justify-between gap-4 p-4">
            <div className="min-w-0 space-y-1 text-sm">
              <p className="font-medium">{r.name} <span className="font-mono text-xs text-muted-foreground">{r.rollNumber}</span></p>
              <p className="text-xs text-muted-foreground">{r.collegeName} · {r.courseName} · {r.department} · {r.section} · {r.academicYear} · {r.category === "SPOT" ? "Spot" : `Category ${r.category}`}{r.category === "A" ? ` ${r.funding}` : ""}</p>
              <p>Asks <span className="font-semibold">{rupee(r.amount)}</span> on {r.headName ?? "the whole fee"} <span className="text-xs text-muted-foreground">(fee {rupee(r.gross)}, pays {rupee(r.studentShare)})</span></p>
              <p className="text-xs"><span className="text-muted-foreground">Reason:</span> {r.reason}</p>
              <p className="text-xs"><span className="text-muted-foreground">Referral:</span> {r.referralName}{r.referralDetails ? ` · ${r.referralDetails}` : ""}</p>
              <p className="text-xs text-muted-foreground">Asked by {r.requestedByName} on {formatDateTime(new Date(r.requestedAt))}</p>
              {r.status !== "PENDING" && <p className="text-xs"><Badge variant="outline" className={r.status === "APPROVED" ? "border-emerald-400 text-emerald-800 dark:text-emerald-300" : "text-destructive"}>{r.status === "APPROVED" ? `Approved ${rupee(r.approvedAmount ?? 0)}` : "Rejected"}</Badge> {r.decidedByName} · {r.decidedAt ? formatDateTime(new Date(r.decidedAt)) : ""}{r.remarks ? ` · ${r.remarks}` : ""}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm" variant="outline"><a href={r.letterUrl} target="_blank" rel="noreferrer"><FileText className="mr-1 h-4 w-4" />Letter</a></Button>
              {r.status === "PENDING" && <>
                <Button size="sm" variant="outline" onClick={() => setDeciding({ r, action: "REJECT" })}>Reject</Button>
                <Button size="sm" onClick={() => setDeciding({ r, action: "APPROVE" })}>Approve</Button>
              </>}
            </div>
          </CardContent></Card>
        ))}</div>
      )}
      {deciding && <DecideDialog {...deciding} onClose={() => setDeciding(null)} onSaved={() => { setDeciding(null); setTick((n) => n + 1); }} />}
    </div>
  );
}

function DecideDialog({ r, action, onClose, onSaved }: { r: FeeConcessionRequest; action: "APPROVE" | "REJECT"; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(String(r.amount));
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/management/fee-concessions/${encodeURIComponent(r.collegeId)}/${encodeURIComponent(r.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...(action === "APPROVE" ? { amount: Number(amount) } : {}), remarks }) });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Unable to save the decision.");
      toast({ variant: "success", title: action === "APPROVE" ? "Concession approved and applied." : "Request rejected." });
      onSaved();
    } catch (e) { toast({ variant: "destructive", title: (e as Error).message }); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{action === "APPROVE" ? "Approve Concession" : "Reject Request"}</DialogTitle><DialogDescription>{r.name} ({r.rollNumber}), {r.collegeName}: asked {rupee(r.amount)} on {r.headName ?? "the whole fee"}.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          {action === "APPROVE" && <div className="space-y-1"><Label htmlFor="dc-amt">Approve (₹)</Label><Input id="dc-amt" type="number" min={1} max={r.amount} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} /><p className="text-xs text-muted-foreground">The amount asked, or less.</p></div>}
          <div className="space-y-1"><Label htmlFor="dc-rem">{action === "APPROVE" ? "Remarks (optional)" : "Reason"}</Label><Textarea id="dc-rem" rows={2} maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} variant={action === "REJECT" ? "destructive" : "default"} disabled={action === "REJECT" && !remarks.trim()} onClick={() => void save()}>{action === "APPROVE" ? "Approve" : "Reject"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
