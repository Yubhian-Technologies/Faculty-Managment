"use client";

import { useEffect, useState, useCallback } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { CalendarClock, Check, X } from "lucide-react";
import { LEAVE_TYPE_LABELS } from "@/types/leave";
import type { LeaveRequest } from "@/types/leave";

// Shared by /hod/leave-approvals (department queue) and /principal/leave-approvals
// (college-wide final sign-off) - the API scopes the results server-side.
//
// Standard types (CL/SL/SCL/EL/OD) only ever appear in the HOD's queue - the
// HOD's decision there is final. "Other" requests can appear in either queue:
// the HOD tags paid/unpaid and forwards (status still PENDING_HOD here), the
// Principal then sees that tag read-only and gives the real final decision
// (status PENDING_PRINCIPAL).
export function LeaveApprovalQueue() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [remarksById, setRemarksById] = useState<Record<string, string>>({});
  const [paidById, setPaidById] = useState<Record<string, boolean>>({});
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/leave/applications?scope=approvals");
      const data = (await res.json()) as { requests?: LeaveRequest[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load approvals");
      setRequests(data.requests ?? []);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to load approvals" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(r: LeaveRequest, action: "APPROVE" | "REJECT") {
    const isHodOtherDecision = r.status === "PENDING_HOD" && !!r.isOtherRequest;
    if (action === "APPROVE" && isHodOtherDecision && paidById[r.id] === undefined) {
      toast({ variant: "destructive", title: "Select whether this is paid or unpaid leave" });
      return;
    }
    setActingId(r.id);
    try {
      const res = await fetch(`/api/leave/applications/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          remarks: remarksById[r.id],
          isPaidLeave: isHodOtherDecision ? paidById[r.id] : undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Action failed");
      toast({
        variant: "success",
        title: action === "REJECT" ? "Request rejected" : isHodOtherDecision ? "Forwarded to Principal" : "Request approved",
      });
      setRequests((prev) => prev.filter((req) => req.id !== r.id));
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Action failed" });
    } finally {
      setActingId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  if (requests.length === 0) {
    return <EmptyState icon={<CalendarClock className="h-6 w-6" />} title="No pending leave requests" />;
  }

  return (
    <div className="space-y-3">
      {requests.map((r) => {
        const isOtherRequest = !!r.isOtherRequest;
        const isHodOtherDecision = r.status === "PENDING_HOD" && isOtherRequest;
        return (
          <Card key={r.id}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold">{r.employeeName}</p>
                  <p className="text-sm text-muted-foreground">{r.department}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {isOtherRequest ? "Other" : LEAVE_TYPE_LABELS[r.leaveTypeCode!]}
                  </Badge>
                  {isOtherRequest && !isHodOtherDecision && r.isPaidLeave !== undefined && (
                    <Badge variant={r.isPaidLeave ? "approved" : "modified"}>
                      {r.isPaidLeave ? "Paid" : "Unpaid"}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="text-sm">
                <p>
                  {formatDate(r.fromDate)} - {formatDate(r.toDate)} &middot; {r.totalDays} day(s)
                </p>
                <p className="text-muted-foreground mt-1">{r.reason}</p>
              </div>

              {isHodOtherDecision && (
                <div className="max-w-xs space-y-1.5">
                  <label className="text-xs text-muted-foreground">Paid or unpaid?</label>
                  <Select
                    value={paidById[r.id] === undefined ? "" : String(paidById[r.id])}
                    onValueChange={(v) => setPaidById((prev) => ({ ...prev, [r.id]: v === "true" }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select paid or unpaid" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Paid</SelectItem>
                      <SelectItem value="false">Unpaid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Textarea
                placeholder="Remarks (optional)"
                rows={2}
                value={remarksById[r.id] ?? ""}
                onChange={(e) => setRemarksById((prev) => ({ ...prev, [r.id]: e.target.value }))}
              />

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={actingId === r.id}
                  onClick={() => act(r, "REJECT")}
                >
                  <X className="h-4 w-4 mr-1" /> Reject
                </Button>
                <Button size="sm" disabled={actingId === r.id} onClick={() => act(r, "APPROVE")}>
                  <Check className="h-4 w-4 mr-1" /> {isHodOtherDecision ? "Forward to Principal" : "Approve"}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
