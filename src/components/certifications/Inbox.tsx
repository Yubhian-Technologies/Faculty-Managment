"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/shared/EmptyState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { toDate } from "@/lib/utils";
import { Inbox as InboxIcon, Search } from "lucide-react";
import type { CertificateRequest, ParallelBranchDef } from "@/types";
import { decideRequest, listRequests } from "./api";
import { StatusBadge } from "./StatusBadge";
import { StudentProfileDialog } from "./StudentProfileDialog";
import { bulkClear, decideLine, loadResultCheck, returnRequest } from "./configApi";
import { RequestAnswers, StepTimeline } from "./StepTimeline";

// One inbox for every approver (HOD, Library, Hostel, Exam Cell, a mentor ...): what is waiting on THIS person now.
// A department line of a configured request shows the buttons of its kind of check - dues (No dues / Dues pending /
// Not applicable), approval (Approve / Send back / Reject) or result (Pass / Fail from published results, then
// Approve / Reject) - and only the lines that are this person's. Many students can be cleared at once.

type InboxRequest = CertificateRequest & { myBranchKeys?: string[] };

const when = (ts: unknown) => {
  const d = toDate(ts as never);
  return d ? d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
};

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** The lines of the current parallel step this person can act on (all pending ones for the prototype No Due). */
function myLines(r: InboxRequest): ParallelBranchDef[] {
  const step = r.flow[r.currentStepIndex];
  const state = r.steps[r.currentStepIndex];
  if (step?.type !== "PARALLEL" || state?.type !== "PARALLEL") return [];
  return step.branches.filter((b) => state.branches.find((x) => x.branchKey === b.key)?.status === "PENDING" && (!r.myBranchKeys || r.myBranchKeys.includes(b.key)));
}

function ResultLine({ requestId }: { requestId: string }) {
  const [result, setResult] = useState<{ outcome: string; backlogs: string[] } | null>(null);
  useEffect(() => {
    let off = false;
    loadResultCheck(requestId).then((r) => { if (!off) setResult(r); }).catch(() => { if (!off) setResult({ outcome: "UNKNOWN", backlogs: [] }); });
    return () => { off = true; };
  }, [requestId]);
  if (!result) return <span className="text-xs text-muted-foreground">Checking results…</span>;
  if (result.outcome === "PASS") return <span className="text-xs font-semibold text-emerald-700">Pass - no backlogs</span>;
  if (result.outcome === "FAIL") return <span className="text-xs font-semibold text-red-700">Fail - {result.backlogs.length} backlog{result.backlogs.length === 1 ? "" : "s"}: {result.backlogs.join(", ")}</span>;
  if (result.outcome === "NO_RESULTS") return <span className="text-xs font-semibold text-amber-700">No published results yet</span>;
  return <span className="text-xs text-muted-foreground">Results could not be read</span>;
}

function LineRow({ request, line, busy, run }: {
  request: InboxRequest; line: ParallelBranchDef; busy: boolean;
  run: (body: Parameters<typeof decideLine>[1], done: string) => Promise<void>;
}) {
  const state = request.steps[request.currentStepIndex];
  const clearance = state?.type === "PARALLEL" ? state.branches.find((b) => b.branchKey === line.key) : undefined;
  const [dues, setDues] = useState<{ amount: string; reason: string } | null>(null);
  const [remarks, setRemarks] = useState("");
  const check = request.certificateTypeId ? line.check ?? "APPROVAL" : "LEGACY";
  const need = (what: string) => { if (!remarks.trim()) { toast({ variant: "destructive", title: what }); return false; } return true; };

  return (
    <div className="rounded-md border p-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{line.label}</span>
        {check === "RESULT" && <ResultLine requestId={request.id} />}
        {clearance?.duesPending && (
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs text-orange-800 dark:bg-orange-950 dark:text-orange-200">
            Dues pending: Rs. {clearance.duesPending.amount} - {clearance.duesPending.reason}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {check === "DUES" && (
          <>
            <Button size="sm" disabled={busy} onClick={() => run({ action: "APPROVE", branchKey: line.key, outcome: "NO_DUES" }, "Marked No dues")}>No dues</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setDues(dues ? null : { amount: "", reason: "" })}>Dues pending</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run({ action: "APPROVE", branchKey: line.key, outcome: "NOT_APPLICABLE" }, "Marked Not applicable")}>Not applicable</Button>
          </>
        )}
        {(check === "APPROVAL" || check === "RESULT" || check === "LEGACY") && (
          <Button size="sm" disabled={busy} onClick={() => run({ action: "APPROVE", branchKey: line.key }, "Approved")}>{check === "LEGACY" ? "Clear" : "Approve"}</Button>
        )}
        {check !== "LEGACY" && check !== "RESULT" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => need("Say what the student must correct") && run({ action: "RETURN", branchKey: line.key, remarks: remarks.trim() }, "Sent back to the student")}>Send back</Button>
        )}
        {check !== "DUES" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => need("Add a reason for rejecting") && run({ action: "REJECT", branchKey: line.key, remarks: remarks.trim() }, "Rejected")}>Reject</Button>
        )}
      </div>
      {dues && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">Amount (Rs.)</Label><Input className="w-28" type="number" min={0} value={dues.amount} onChange={(e) => setDues({ ...dues, amount: e.target.value })} /></div>
          <div className="space-y-1 flex-1 min-w-48"><Label className="text-xs">For what</Label><Input value={dues.reason} placeholder="e.g. Lost book - Data Structures" onChange={(e) => setDues({ ...dues, reason: e.target.value })} /></div>
          <Button size="sm" disabled={busy || !dues.amount || !dues.reason.trim()}
            onClick={() => run({ action: "DUES_PENDING", branchKey: line.key, amount: Number(dues.amount), remarks: dues.reason.trim() }, "Dues recorded - the student is told").then(() => setDues(null))}>Save dues</Button>
        </div>
      )}
      {check !== "DUES" || !dues ? (
        <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={check === "DUES" ? "Remarks (to send back)" : "Remarks (required to reject or send back)"} className="h-8 text-sm" />
      ) : null}
    </div>
  );
}

function InboxCard({ request, onDecided, selected, onSelect }: { request: InboxRequest; onDecided: () => void; selected: boolean; onSelect?: (on: boolean) => void }) {
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const step = request.flow[request.currentStepIndex];
  const configured = Boolean(request.certificateTypeId);
  const lines = myLines(request);

  async function run(body: Parameters<typeof decideLine>[1], done: string) {
    setBusy(true);
    try {
      if (configured) await decideLine(request.id, body);
      else await decideRequest(request.id, body.action === "REJECT" ? "REJECT" : "APPROVE", body.remarks, body.branchKey);
      toast({ variant: "success", title: done });
      onDecided();
    } catch (e) {
      toast({ variant: "destructive", title: errText(e, "That didn't work") });
    } finally {
      setBusy(false);
    }
  }

  async function actSequential(action: "APPROVE" | "REJECT" | "RETURN") {
    if (action !== "APPROVE" && !remarks.trim()) {
      toast({ variant: "destructive", title: action === "RETURN" ? "Say what the student must correct" : "Add a reason for rejecting" });
      return;
    }
    setBusy(true);
    try {
      if (action === "RETURN") await returnRequest(request.id, remarks.trim());
      else await decideRequest(request.id, action, remarks.trim() || undefined);
      toast({ variant: "success", title: action === "APPROVE" ? "Decision recorded" : action === "RETURN" ? "Sent back to the student" : "Rejected" });
      onDecided();
    } catch (e) {
      toast({ variant: "destructive", title: errText(e, "That didn't work") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex min-w-0 gap-3">
            {onSelect && <Checkbox className="mt-1" checked={selected} onCheckedChange={(c) => onSelect(c === true)} aria-label={`Select ${request.studentName}`} />}
            <div className="min-w-0">
              <p className="font-semibold">{request.studentName} · {request.studentRollNumber}</p>
              <p className="text-xs text-muted-foreground">{request.studentDepartment} · Year {request.studentYear} · Section {request.studentSection}</p>
              <p className="text-xs text-muted-foreground mt-1">{request.certificateTypeLabel} · {request.startedByUid ? "Started by the College Office" : "Submitted"} {when(request.createdAt)}</p>
            </div>
          </div>
          <StatusBadge status={request.status} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <StudentProfileDialog requestId={request.id} studentName={request.studentName} />
          {configured && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">All approvals</summary>
              <div className="mt-2"><StepTimeline request={request} /></div>
            </details>
          )}
        </div>
        {configured && <RequestAnswers request={request} />}

        {step?.type === "SEQUENTIAL" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`remarks-${request.id}`}>{configured ? "Remarks (required to reject or send back)" : "Remarks (required to reject)"}</Label>
              <Textarea id={`remarks-${request.id}`} value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => actSequential("APPROVE")} disabled={busy}>Approve</Button>
              {configured && <Button variant="outline" onClick={() => actSequential("RETURN")} disabled={busy}>Send back for correction</Button>}
              <Button variant="outline" onClick={() => actSequential("REJECT")} disabled={busy}>Reject</Button>
            </div>
          </>
        )}

        {step?.type === "PARALLEL" && (
          <div className="space-y-2">
            {lines.length === 0 && <p className="text-sm text-muted-foreground">Nothing left for you on this one.</p>}
            {lines.map((line) => <LineRow key={line.key} request={request} line={line} busy={busy} run={run} />)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** One inbox component for every role - listInbox already scopes to exactly what this caller can act on. */
export function Inbox() {
  const [requests, setRequests] = useState<InboxRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [line, setLine] = useState("ALL");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRequests(await listRequests("inbox"));
      setSelected(new Set());
    } catch (e) {
      toast({ variant: "destructive", title: errText(e, "Unable to load your inbox") });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The department lines this person clears, across every request (for the filter and the bulk action).
  const lineOptions = useMemo(() => {
    const m = new Map<string, { label: string; check: string }>();
    for (const r of requests) if (r.certificateTypeId) for (const l of myLines(r)) m.set(l.key, { label: l.label, check: l.check ?? "APPROVAL" });
    return [...m].map(([key, v]) => ({ key, ...v }));
  }, [requests]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests.filter((r) => (!q || [r.studentName, r.studentRollNumber, r.studentSection, r.certificateTypeLabel].some((v) => v?.toLowerCase().includes(q)))
      && (line === "ALL" || myLines(r).some((l) => l.key === line)));
  }, [requests, query, line]);

  const chosen = lineOptions.find((o) => o.key === line);
  const canBulk = Boolean(chosen && chosen.check !== "RESULT");

  async function bulk(outcome?: "NO_DUES" | "NOT_APPLICABLE") {
    const items = shown.filter((r) => selected.has(r.id)).map((r) => ({ id: r.id, branchKey: line }));
    if (items.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await bulkClear(items, outcome);
      toast({
        variant: res.failed.length ? "destructive" : "success",
        title: `${res.done.length} cleared${res.failed.length ? `, ${res.failed.length} not: ${res.failed[0].error}` : ""}`,
      });
      load();
    } catch (e) {
      toast({ variant: "destructive", title: errText(e, "Unable to clear them") });
    } finally {
      setBulkBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (requests.length === 0) {
    return (
      <Card>
        <EmptyState icon={<InboxIcon className="h-6 w-6" />} title="No requests currently" description="Nothing is waiting on your decision right now." />
      </Card>
    );
  }

  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Student, Regd. No, section…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {lineOptions.length > 0 && (
          <Select value={line} onValueChange={(v) => { setLine(v); setSelected(new Set()); }}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All my lines</SelectItem>
              {lineOptions.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <p className="text-sm text-muted-foreground sm:ml-auto">{shown.length} waiting</p>
      </div>

      {canBulk && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox checked={allShownSelected} onCheckedChange={(c) => setSelected(c ? new Set(shown.map((r) => r.id)) : new Set())} /> Select all ({shown.length})
          </label>
          <span className="text-muted-foreground">{selected.size} selected - {chosen?.label}:</span>
          {chosen?.check === "DUES" ? (
            <>
              <Button size="sm" disabled={!selected.size} loading={bulkBusy} onClick={() => bulk("NO_DUES")}>No dues</Button>
              <Button size="sm" variant="outline" disabled={!selected.size || bulkBusy} onClick={() => bulk("NOT_APPLICABLE")}>Not applicable</Button>
            </>
          ) : (
            <Button size="sm" disabled={!selected.size} loading={bulkBusy} onClick={() => bulk()}>Approve</Button>
          )}
        </div>
      )}
      {lineOptions.length > 1 && line === "ALL" && <p className="text-xs text-muted-foreground">Pick one of your lines above to clear many students at once.</p>}

      {shown.map((r) => (
        <InboxCard key={r.id} request={r} onDecided={load} selected={selected.has(r.id)}
          onSelect={canBulk ? (on) => setSelected((s) => { const n = new Set(s); if (on) n.add(r.id); else n.delete(r.id); return n; }) : undefined} />
      ))}
    </div>
  );
}
