"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import { actOnRequest, listRequests, type ListView, type PermissionRequestView, type RequestAction } from "./api";
import { formatPeriods, formatRange, stageLabel, StatusBadge } from "./statusBadge";

// A list of requests with the actions that make sense in that context:
//   mine       - withdraw while pending
//   inbox      - approve / reject what is waiting for me
//   oversight  - everything in my departments; revoke an approval, retry a failed attendance update

type Pending = { request: PermissionRequestView; action: RequestAction; needsRemark: boolean } | null;

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function Route({ request }: { request: PermissionRequestView }) {
  const skipped = new Set(request.history.filter((h) => h.action === "SKIP").map((h) => h.stage));
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Approval route">
      {request.chain.map((stage, i) => {
        const done = request.status === "APPROVED" || request.status === "REVOKED" || i < request.stageIndex;
        const current = request.status === "PENDING" && i === request.stageIndex;
        const rejected = request.status === "REJECTED" && i === request.stageIndex;
        return (
          <li key={stage} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground">→</span>}
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
              rejected ? "border-red-300 bg-red-50 text-red-800" : current ? "border-primary bg-primary/10 text-primary font-medium" : done ? "border-green-300 bg-green-50 text-green-800" : "text-muted-foreground"
            }`}>
              {done && !skipped.has(stage) && <Check className="h-3 w-3" />}
              {stageLabel(stage)}{skipped.has(stage) ? " (skipped)" : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RequestCard({ request, view, viewerUid, onAct }: { request: PermissionRequestView; view: ListView; viewerUid: string; onAct: (p: NonNullable<Pending>) => void }) {
  const p = request.payload;
  const [open, setOpen] = useState(false);
  const mine = request.requesterUid === viewerUid;
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold break-words">{p.title}</p>
            <p className="text-xs text-muted-foreground">{p.categoryLabel} · {formatRange(p.fromDate, p.toDate)} · {formatPeriods(p.periods)}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {p.late && <Badge variant="outline" className="border-amber-300 text-amber-800" title="Raised with less than the preferred notice"><AlertTriangle className="h-3 w-3 mr-1" />Short notice</Badge>}
            <StatusBadge request={request} />
          </div>
        </div>

        <p className="text-sm whitespace-pre-wrap break-words">{p.description}</p>
        {p.venue && <p className="text-xs text-muted-foreground">Venue: {p.venue}</p>}

        <div className="text-sm">
          <span className="text-muted-foreground">{request.requesterType === "FACULTY" ? "Raised by " : "Student: "}</span>
          <span className="font-medium">{request.requesterName}</span>
          {request.requesterType === "FACULTY" && <span className="text-muted-foreground"> for {p.students.length} student{p.students.length === 1 ? "" : "s"}</span>}
          <span className="text-muted-foreground"> · {request.scope}</span>
        </div>
        {(request.requesterType === "FACULTY" || p.students.length > 1) && (
          <div className="flex flex-wrap gap-1">
            {p.students.slice(0, open ? undefined : 6).map((s) => <Badge key={s.id} variant="secondary" className="font-normal">{s.rollNumber} · {s.name}</Badge>)}
            {!open && p.students.length > 6 && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setOpen(true)}>+{p.students.length - 6} more</button>}
          </div>
        )}

        <Route request={request} />

        {p.proof.length > 0 && (
          <div className="flex flex-wrap gap-3 text-sm">
            {p.proof.map((f) => <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="h-3.5 w-3.5" />{f.name}</a>)}
          </div>
        )}

        {request.effectStatus === "FAILED" && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800" role="alert">
            Approved, but updating attendance already marked for these days didn&apos;t finish. New periods are still marked On Duty.
            {view !== "mine" && <Button size="sm" variant="outline" className="h-7" onClick={() => onAct({ request, action: "RETRY", needsRemark: false })}><RefreshCw className="h-3.5 w-3.5 mr-1" />Retry</Button>}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />History
          </button>
          <div className="flex gap-2">
            {mine && request.status === "PENDING" && <Button size="sm" variant="outline" onClick={() => onAct({ request, action: "CANCEL", needsRemark: false })}>Withdraw</Button>}
            {view === "inbox" && request.status === "PENDING" && !mine && (
              <>
                <Button size="sm" variant="outline" className="text-destructive" onClick={() => onAct({ request, action: "REJECT", needsRemark: true })}>Reject</Button>
                <Button size="sm" onClick={() => onAct({ request, action: "APPROVE", needsRemark: false })}>Approve</Button>
              </>
            )}
            {view === "oversight" && request.status === "APPROVED" && !mine && <Button size="sm" variant="outline" onClick={() => onAct({ request, action: "REVOKE", needsRemark: true })}>Revoke</Button>}
          </div>
        </div>

        {open && (
          <ol className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
            {request.history.map((h, i) => (
              <li key={i}><span className="text-foreground font-medium">{h.actorName}</span> {({ SUBMIT: "raised it", APPROVE: "approved", REJECT: "rejected", CANCEL: "withdrew it", REVOKE: "revoked it", SKIP: "(skipped)" })[h.action]}
                {h.stage ? ` as ${stageLabel(h.stage)}` : ""} · {when(h.at)}{h.remark ? ` - “${h.remark}”` : ""}</li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

const COPY: Record<RequestAction, { title: string; confirm: string; done: string; remarkLabel: string }> = {
  APPROVE: { title: "Approve this request?", confirm: "Approve", done: "Approved", remarkLabel: "Note (optional)" },
  REJECT: { title: "Reject this request?", confirm: "Reject", done: "Rejected", remarkLabel: "Reason (required)" },
  CANCEL: { title: "Withdraw this request?", confirm: "Withdraw", done: "Request withdrawn", remarkLabel: "Note (optional)" },
  REVOKE: { title: "Revoke this approval?", confirm: "Revoke", done: "Approval revoked - attendance restored", remarkLabel: "Reason (required)" },
  RETRY: { title: "Retry the attendance update?", confirm: "Retry", done: "Attendance updated", remarkLabel: "" },
};

export function RequestList({ view, empty }: { view: ListView; empty: string }) {
  const viewerUid = useAuthStore((s) => s.user?.uid) ?? "";
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["student-permissions", view], queryFn: () => listRequests(view), staleTime: 15_000 });
  const [pending, setPending] = useState<Pending>(null);
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!pending) return;
    if (pending.needsRemark && !remark.trim()) { toast({ variant: "destructive", title: "Please add a reason" }); return; }
    setBusy(true);
    try {
      await actOnRequest(pending.request.id, pending.action, remark.trim() || undefined);
      toast({ variant: "success", title: COPY[pending.action].done });
      setPending(null); setRemark("");
      await qc.invalidateQueries({ queryKey: ["student-permissions"] });
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "That didn't work" }); }
    finally { setBusy(false); }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (isError) return <p className="text-sm text-destructive">Couldn&apos;t load requests. <button className="underline" onClick={() => void refetch()}>Try again</button></p>;
  if (!data?.length) return <p className="text-sm text-muted-foreground">{empty}</p>;

  const copy = pending ? COPY[pending.action] : null;
  return (
    <>
      <div className="space-y-3">{data.map((r) => <RequestCard key={r.id} request={r} view={view} viewerUid={viewerUid} onAct={(p) => { setRemark(""); setPending(p); }} />)}</div>
      <Dialog open={!!pending} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy?.title}</DialogTitle>
            <DialogDescription>{pending?.request.payload.title} · {pending?.request.requesterName}</DialogDescription>
          </DialogHeader>
          {copy?.remarkLabel && (
            <div className="space-y-1.5">
              <Label htmlFor="act-remark">{copy.remarkLabel}</Label>
              <Textarea id="act-remark" rows={3} maxLength={500} value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>Cancel</Button>
            <Button variant={pending?.action === "REJECT" || pending?.action === "REVOKE" ? "destructive" : "default"} loading={busy} onClick={() => void confirm()}>{copy?.confirm}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
