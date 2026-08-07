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
import type { LeaveRequest, LeaveTypeCode } from "@/types/leave";

const ASSIGNABLE_TYPES: LeaveTypeCode[] = ["CL", "SL", "SCL", "EL", "OD"];

// Shared by /hod/leave-approvals (department queue) and /principal/leave
// (college-wide final sign-off) - the API scopes the results server-side.
export function LeaveApprovalQueue() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [remarksById, setRemarksById] = useState<Record<string, string>>({});
  const [assignedTypeById, setAssignedTypeById] = useState<Record<string, LeaveTypeCode>>({});
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/leave/applications?scope=approvals");
      const data = (await res.json()) as { requests: LeaveRequest[] };
      setRequests(data.requests ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load approvals" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string, action: "APPROVE" | "REJECT", isUnassignedOther: boolean) {
    if (action === "APPROVE" && isUnassignedOther && !assignedTypeById[id]) {
      toast({ variant: "destructive", title: "Pick a leave type to sanction this request against" });
      return;
    }
    setActingId(id);
    try {
      const res = await fetch(`/api/leave/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          remarks: remarksById[id],
          assignedLeaveTypeCode: assignedTypeById[id],
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Action failed");
      toast({ variant: "success", title: action === "APPROVE" ? "Request approved" : "Request rejected" });
      setRequests((prev) => prev.filter((r) => r.id !== id));
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
        const isUnassignedOther = !!r.isOtherRequest && !r.leaveTypeCode;
        return (
          <Card key={r.id}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold">{r.employeeName}</p>
                  <p className="text-sm text-muted-foreground">{r.department}</p>
                </div>
                <Badge variant="secondary">
                  {isUnassignedOther ? "Other" : LEAVE_TYPE_LABELS[r.leaveTypeCode!]}
                </Badge>
              </div>
              <div className="text-sm">
                <p>
                  {formatDate(r.fromDate)} - {formatDate(r.toDate)} &middot; {r.totalDays} day(s)
                </p>
                <p className="text-muted-foreground mt-1">{r.reason}</p>
              </div>

              {isUnassignedOther && (
                <div className="max-w-xs space-y-1.5">
                  <label className="text-xs text-muted-foreground">Sanction against</label>
                  <Select
                    value={assignedTypeById[r.id] ?? ""}
                    onValueChange={(v) => setAssignedTypeById((prev) => ({ ...prev, [r.id]: v as LeaveTypeCode }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select leave type" />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSIGNABLE_TYPES.map((code) => (
                        <SelectItem key={code} value={code}>
                          {LEAVE_TYPE_LABELS[code]}
                        </SelectItem>
                      ))}
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
                  onClick={() => act(r.id, "REJECT", isUnassignedOther)}
                >
                  <X className="h-4 w-4 mr-1" /> Reject
                </Button>
                <Button size="sm" disabled={actingId === r.id} onClick={() => act(r.id, "APPROVE", isUnassignedOther)}>
                  <Check className="h-4 w-4 mr-1" /> Approve
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
