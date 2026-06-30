"use client";

import { useEffect, useState, useCallback } from "react";
import {
  CheckCircle,
  XCircle,
  CalendarDays,
  User,
  BookOpen,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { LeaveRequestV2, LeaveTypeCodeV2 } from "@/types/leave";

const LT_LABELS: Partial<Record<LeaveTypeCodeV2, string>> = {
  CL: "Casual Leave", SCL: "Special Casual Leave", EL: "Earned Leave",
  ML: "Sick Leave", MAT: "Maternity Leave", FPL: "Family Planning Leave",
  COMP: "Compensatory Leave", LND: "Leave Not Due", QUAR: "Quarantine Leave",
  EOL: "Extraordinary Leave", SAB: "Sabbatical Leave", VAC: "Vacation",
};

interface RejectState {
  requestId: string;
  comments: string;
  saving: boolean;
}

export default function HODLeaveApprovalsPage() {
  const [requests, setRequests] = useState<LeaveRequestV2[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectState, setRejectState] = useState<RejectState | null>(null);

  const load = useCallback(() => {
    setIsLoading(true);
    fetch("/api/leave/applications?dept=true")
      .then((r) => r.json() as Promise<{ requests: LeaveRequestV2[] }>)
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load leave applications" }))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleApprove(id: string) {
    setApprovingId(id);
    try {
      const res = await fetch(`/api/leave/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "APPROVE" }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Failed to approve");
      }
      toast({ variant: "success", title: "Leave approved", description: "Forwarded to Principal for ratification." });
      setRequests((prev) => prev.filter((r) => r.id !== id));
      setExpandedId(null);
    } catch (err) {
      toast({ variant: "destructive", title: "Approval failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setApprovingId(null);
    }
  }

  async function handleRejectConfirm() {
    if (!rejectState) return;
    const { requestId, comments } = rejectState;
    setRejectState((prev) => prev && { ...prev, saving: true });
    try {
      const res = await fetch(`/api/leave/applications/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REJECT", comments: comments.trim() || undefined }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Failed to reject");
      }
      toast({ variant: "success", title: "Leave rejected" });
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
      setRejectState(null);
      setExpandedId(null);
    } catch (err) {
      toast({ variant: "destructive", title: "Rejection failed", description: err instanceof Error ? err.message : undefined });
      setRejectState((prev) => prev && { ...prev, saving: false });
    }
  }

  const isAnyActionRunning = approvingId !== null || rejectState?.saving === true;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Approvals"
        description="Review and approve faculty leave applications from your department"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Pending Applications
            {!isLoading && requests.length > 0 && (
              <Badge variant="secondary">{requests.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-24 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : requests.length === 0 ? (
            <EmptyState
              title="No pending leave applications"
              description="All faculty leave applications from your department will appear here."
              icon={<CalendarDays className="h-8 w-8" />}
            />
          ) : (
            <div className="space-y-3">
              {requests.map((req) => {
                const isExpanded = expandedId === req.id;
                const isApprovingThis = approvingId === req.id;
                const isRejectingThis = rejectState?.requestId === req.id;

                return (
                  <div
                    key={req.id}
                    className="rounded-lg border bg-card"
                  >
                    {/* Summary row — always visible */}
                    <button
                      type="button"
                      className="w-full text-left p-4 space-y-2"
                      onClick={() => setExpandedId(isExpanded ? null : req.id)}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-semibold text-sm">{req.employeeName}</span>
                          <Badge variant="secondary" className="text-xs">{req.department}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs bg-yellow-50 text-yellow-700 border-yellow-200">
                            Pending HOD
                          </Badge>
                          {isExpanded
                            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          }
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <BookOpen className="h-4 w-4 shrink-0" />
                        <span className="font-medium text-foreground">
                          {LT_LABELS[req.leaveTypeCode] ?? req.leaveTypeCode}
                        </span>
                        <span>·</span>
                        <CalendarDays className="h-4 w-4 shrink-0" />
                        <span>
                          {formatDate(req.fromDate as Parameters<typeof formatDate>[0])}
                          {" – "}
                          {formatDate(req.toDate as Parameters<typeof formatDate>[0])}
                        </span>
                        <span>·</span>
                        <span>
                          {req.isHalfDay
                            ? `Half day${req.halfDaySession ? ` (${req.halfDaySession.toLowerCase()})` : ""}`
                            : `${req.computedDays} day${req.computedDays !== 1 ? "s" : ""}`}
                        </span>
                      </div>
                    </button>

                    {/* Expanded details + actions */}
                    {isExpanded && (
                      <div className="border-t px-4 pb-4 pt-3 space-y-3">
                        <div className="text-sm">
                          <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Reason</span>
                          <p className="mt-1 rounded bg-muted/40 p-2">{req.reason}</p>
                        </div>

                        {req.substituteArrangement && (
                          <div className="text-sm">
                            <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Substitute</span>
                            <p className="mt-1 text-muted-foreground">{req.substituteArrangement}</p>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-xs text-muted-foreground">Leave address</span>
                            <p className="font-medium">{req.leaveAddress}</p>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">Contact</span>
                            <p className="font-medium">{req.contactNumber}</p>
                          </div>
                        </div>

                        {/* Inline reject form */}
                        {isRejectingThis && (
                          <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                            <Label htmlFor={`comments-${req.id}`} className="text-sm font-medium">
                              Rejection remarks <span className="text-muted-foreground">(optional)</span>
                            </Label>
                            <Textarea
                              id={`comments-${req.id}`}
                              value={rejectState.comments}
                              onChange={(e) =>
                                setRejectState((prev) => prev ? { ...prev, comments: e.target.value.slice(0, 200) } : prev)
                              }
                              placeholder="Reason for rejection..."
                              rows={2}
                              maxLength={200}
                              disabled={rejectState.saving}
                              className="resize-none text-sm"
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => void handleRejectConfirm()}
                                disabled={rejectState.saving}
                              >
                                <XCircle className="h-4 w-4 mr-1.5" />
                                {rejectState.saving ? "Rejecting…" : "Confirm Reject"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setRejectState(null)}
                                disabled={rejectState.saving}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Action buttons */}
                        {!isRejectingThis && (
                          <div className="flex gap-2 pt-1">
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700 text-white"
                              onClick={() => void handleApprove(req.id)}
                              disabled={isAnyActionRunning}
                              loading={isApprovingThis}
                            >
                              <CheckCircle className="h-4 w-4 mr-1.5" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-destructive text-destructive hover:bg-destructive/10"
                              onClick={() => setRejectState({ requestId: req.id, comments: "", saving: false })}
                              disabled={isAnyActionRunning}
                            >
                              <XCircle className="h-4 w-4 mr-1.5" />
                              Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
