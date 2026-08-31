"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { AdjustmentRequest, LeaveRequest } from "@/types/leave";

interface PeriodCoverageEntry {
  date: string;
  timetableSlotId: string;
  subjectName: string;
  candidates: { facultyId: string; facultyName: string; facultyDepartment?: string }[];
}
interface HandoverCandidate {
  uid: string;
  name: string;
}

// After a named substitute/handover person declines (see /leave/adjustments),
// the requester lands here to pick someone else for that one declined slot -
// see REVISE_ADJUSTMENT in applications/[id]/route.ts. Every other already-
// accepted/still-pending pick on the request is untouched.
export default function ReviseAdjustmentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [request, setRequest] = useState<LeaveRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [periods, setPeriods] = useState<PeriodCoverageEntry[]>([]);
  const [handoverCandidates, setHandoverCandidates] = useState<HandoverCandidate[]>([]);
  const [pickByAssignee, setPickByAssignee] = useState<Record<string, string>>({});
  const [busyUid, setBusyUid] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/leave/applications/${id}`)
      .then((r) => r.json() as Promise<{ request?: LeaveRequest }>)
      .then((d) => setRequest(d.request ?? null))
      .catch(() => toast({ variant: "destructive", title: "Failed to load leave request" }))
      .finally(() => setIsLoading(false));
  }, [id]);

  const declined = useMemo(
    () => (request?.adjustmentRequests ?? []).filter((a) => a.status === "DECLINED"),
    [request]
  );

  useEffect(() => {
    if (!request) return;
    if (declined.some((a) => a.kind === "SUBSTITUTE")) {
      fetch(`/api/leave/period-coverage?requestId=${id}`)
        .then((r) => r.json() as Promise<{ periods?: PeriodCoverageEntry[] }>)
        .then((d) => setPeriods(d.periods ?? []))
        .catch(() => { /* substitute picker just stays empty */ });
    }
    if (declined.some((a) => a.kind === "HANDOVER")) {
      fetch("/api/leave/handover-candidates")
        .then((r) => r.json() as Promise<{ candidates?: HandoverCandidate[] }>)
        .then((d) => setHandoverCandidates(d.candidates ?? []))
        .catch(() => { /* handover picker just stays empty */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // Candidates eligible for every period the declined substitute actually
  // turned down - periods they already accepted within the same bundle stay
  // theirs and aren't touched here (see the PARTIAL response).
  function candidatesFor(a: AdjustmentRequest): { facultyId: string; facultyName: string; facultyDepartment?: string }[] {
    const keys = (a.periods ?? []).filter((p) => p.status === "DECLINED").map((p) => `${p.date}|${p.timetableSlotId}`);
    const matching = periods.filter((p) => keys.includes(`${p.date}|${p.timetableSlotId}`));
    if (matching.length === 0) return [];
    let common = matching[0].candidates;
    for (const p of matching.slice(1)) {
      const ids = new Set(p.candidates.map((c) => c.facultyId));
      common = common.filter((c) => ids.has(c.facultyId));
    }
    return common;
  }

  async function submit(a: AdjustmentRequest) {
    const pick = pickByAssignee[a.assigneeUid];
    if (!pick) {
      toast({ variant: "destructive", title: "Pick a replacement first" });
      return;
    }
    setBusyUid(a.assigneeUid);
    try {
      const res = await fetch(`/api/leave/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REVISE_ADJUSTMENT",
          declinedAssigneeUid: a.assigneeUid,
          ...(a.kind === "SUBSTITUTE" ? { newSubstituteFacultyId: pick } : { newHandoverUid: pick }),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to revise");
      toast({ variant: "success", title: "Sent for acceptance" });
      const r = await fetch(`/api/leave/applications/${id}`);
      const d = (await r.json()) as { request?: LeaveRequest };
      setRequest(d.request ?? null);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to revise" });
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <PageHeader
        title="Pick Someone Else"
        description="Replace a declined substitute or handover pick on your leave request."
        actions={
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />
      {isLoading ? (
        <div className="h-32 rounded-lg border bg-muted/30 animate-pulse" />
      ) : !request ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Leave request not found.</CardContent></Card>
      ) : declined.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Nothing declined on this request right now.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {declined.map((a) => {
            const options = a.kind === "SUBSTITUTE" ? candidatesFor(a) : handoverCandidates.map((c) => ({ facultyId: c.uid, facultyName: c.name, facultyDepartment: undefined }));
            return (
              <Card key={a.assigneeUid}>
                <CardContent className="p-4 space-y-3">
                  <div>
                    <p className="text-sm font-medium">{a.assigneeName} declined ({a.kind === "SUBSTITUTE" ? "Substitute" : "Handover"})</p>
                    {a.declineReason && <p className="text-xs text-muted-foreground mt-0.5">Reason: {a.declineReason}</p>}
                    {a.kind === "SUBSTITUTE" && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {(a.periods ?? []).filter((p) => p.status === "DECLINED").length} of {(a.periods ?? []).length} period(s) declined
                      </p>
                    )}
                  </div>
                  <Select value={pickByAssignee[a.assigneeUid] ?? ""} onValueChange={(v) => setPickByAssignee((prev) => ({ ...prev, [a.assigneeUid]: v }))}>
                    <SelectTrigger><SelectValue placeholder={options.length === 0 ? "None available" : "Select a replacement"} /></SelectTrigger>
                    <SelectContent>
                      {options.map((c) => <SelectItem key={c.facultyId} value={c.facultyId}>
                          {c.facultyName}
                          {c.facultyDepartment && (
                            <span className="text-muted-foreground"> · {c.facultyDepartment}</span>
                          )}
                        </SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="flex justify-end">
                    <Button size="sm" loading={busyUid === a.assigneeUid} onClick={() => void submit(a)}>Send Request</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
