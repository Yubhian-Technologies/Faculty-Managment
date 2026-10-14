"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { toDate } from "@/lib/utils";
import { Inbox as InboxIcon } from "lucide-react";
import type { CertificateRequest } from "@/types";
import { decideRequest, listRequests } from "./api";
import { StatusBadge } from "./StatusBadge";
import { StudentProfileDialog } from "./StudentProfileDialog";

const when = (ts: unknown) => {
  const d = toDate(ts as never);
  return d ? d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
};

function InboxCard({ request, onDecided }: { request: CertificateRequest; onDecided: () => void }) {
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const step = request.flow[request.currentStepIndex];
  const stepState = request.steps[request.currentStepIndex];

  async function act(action: "APPROVE" | "REJECT", branchKey?: string) {
    if (action === "REJECT" && !remarks.trim()) {
      toast({ variant: "destructive", title: "Please add a reason for rejecting" });
      return;
    }
    setBusy(true);
    try {
      await decideRequest(request.id, action, remarks.trim() || undefined, branchKey);
      toast({ variant: "success", title: action === "APPROVE" ? "Decision recorded" : "Rejected" });
      onDecided();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "That didn't work" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <p className="font-semibold">{request.studentName} · {request.studentRollNumber}</p>
            <p className="text-xs text-muted-foreground">{request.studentDepartment} · Year {request.studentYear} · Section {request.studentSection}</p>
            <p className="text-xs text-muted-foreground mt-1">{request.certificateTypeLabel} · Submitted {when(request.createdAt)}</p>
            {request.purpose && <p className="text-xs text-muted-foreground mt-1">Purpose: {request.purpose}</p>}
          </div>
          <StatusBadge status={request.status} />
        </div>

        <StudentProfileDialog requestId={request.id} studentName={request.studentName} />

        <div className="space-y-1.5">
          <Label htmlFor={`remarks-${request.id}`}>Remarks (required to reject)</Label>
          <Textarea id={`remarks-${request.id}`} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>

        {step.type === "SEQUENTIAL" && (
          <div className="flex gap-2">
            <Button onClick={() => act("APPROVE")} disabled={busy}>Approve</Button>
            <Button variant="outline" onClick={() => act("REJECT")} disabled={busy}>Reject</Button>
          </div>
        )}

        {step.type === "PARALLEL" && stepState?.type === "PARALLEL" && (
          <div className="space-y-2">
            {step.branches.map((branch) => {
              const branchState = stepState.branches.find((b) => b.branchKey === branch.key);
              if (!branchState || branchState.status !== "PENDING") return null;
              return (
                <div key={branch.key} className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <span className="text-sm font-medium">{branch.label}</span>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => act("APPROVE", branch.key)} disabled={busy}>Clear</Button>
                    <Button size="sm" variant="outline" onClick={() => act("REJECT", branch.key)} disabled={busy}>Reject</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** One inbox component for every role (HOD, Placement, Library, Hostel, ...) -
 *  listInbox already scopes to exactly what this caller can act on. */
export function Inbox() {
  const [requests, setRequests] = useState<CertificateRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRequests(await listRequests("inbox"));
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't load your inbox" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (requests.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<InboxIcon className="h-6 w-6" />}
          title="No requests currently"
          description="Nothing is waiting on your decision right now."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((r) => <InboxCard key={r.id} request={r} onDecided={load} />)}
    </div>
  );
}
