"use client";

import { useEffect, useState } from "react";
import { CheckCircle, XCircle, CalendarDays, User, BookOpen } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { LEAVE_TYPE_LABELS } from "@/types";
import type { LeaveApplication } from "@/types";

interface RejectState {
  leaveId: string;
  remarks: string;
  saving: boolean;
}

export default function HODLeaveApprovalsPage() {
  const [leaves, setLeaves] = useState<LeaveApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectState, setRejectState] = useState<RejectState | null>(null);

  function load() {
    setIsLoading(true);
    fetch("/api/college/leave-applications?dept=true")
      .then((r) => r.json() as Promise<{ leaves: LeaveApplication[] }>)
      .then((d) => setLeaves(d.leaves ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load leave applications" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleApprove(id: string) {
    setApprovingId(id);
    try {
      const res = await fetch(`/api/college/leave-applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "APPROVED" }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to approve");
      }
      toast({ title: "Leave approved", description: "The leave application has been approved." });
      setLeaves((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Approval failed",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setApprovingId(null);
    }
  }

  function openReject(id: string) {
    setRejectState({ leaveId: id, remarks: "", saving: false });
  }

  function cancelReject() {
    setRejectState(null);
  }

  async function handleRejectConfirm() {
    if (!rejectState) return;
    const { leaveId, remarks } = rejectState;
    setRejectState((prev) => prev && { ...prev, saving: true });
    try {
      const res = await fetch(`/api/college/leave-applications/${leaveId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REJECTED", remarks: remarks.trim() || undefined }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to reject");
      }
      toast({ title: "Leave rejected", description: "The leave application has been rejected." });
      setLeaves((prev) => prev.filter((l) => l.id !== leaveId));
      setRejectState(null);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Rejection failed",
        description: err instanceof Error ? err.message : "Please try again.",
      });
      setRejectState((prev) => prev && { ...prev, saving: false });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Approvals"
        description="Review and approve faculty leave applications"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Pending Applications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-36 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : leaves.length === 0 ? (
            <EmptyState
              title="No pending leave applications"
              description="All faculty leave applications from your department will appear here."
              icon={<CalendarDays className="h-8 w-8" />}
            />
          ) : (
            <div className="space-y-4">
              {leaves.map((leave) => {
                const isApprovingThis = approvingId === leave.id;
                const isRejectingThis = rejectState?.leaveId === leave.id;
                const isAnyActionRunning = approvingId !== null || rejectState?.saving === true;

                return (
                  <div
                    key={leave.id}
                    className="rounded-lg border bg-card p-4 space-y-3"
                  >
                    {/* Header row: name + department */}
                    <div className="flex flex-wrap items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-semibold text-sm">{leave.facultyName}</span>
                      <Badge variant="secondary" className="text-xs">
                        {leave.department}
                      </Badge>
                    </div>

                    {/* Leave type + dates + days */}
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <BookOpen className="h-4 w-4 shrink-0" />
                      <span className="font-medium text-foreground">
                        {LEAVE_TYPE_LABELS[leave.leaveType] ?? leave.leaveType}
                      </span>
                      <span>·</span>
                      <CalendarDays className="h-4 w-4 shrink-0" />
                      <span>
                        {formatDate(leave.fromDate)} – {formatDate(leave.toDate)}
                      </span>
                      <span>·</span>
                      <span>
                        {leave.isHalfDay
                          ? "Half day"
                          : `${leave.totalDays} day${leave.totalDays !== 1 ? "s" : ""}`}
                      </span>
                    </div>

                    {/* Reason */}
                    <div className="text-sm">
                      <span className="font-medium">Reason: </span>
                      <span className="text-muted-foreground">{leave.reason}</span>
                    </div>

                    {/* Substitute arrangement */}
                    {leave.substituteArrangement && (
                      <div className="text-sm">
                        <span className="font-medium">Substitute: </span>
                        <span className="text-muted-foreground">{leave.substituteArrangement}</span>
                      </div>
                    )}

                    {/* Inline reject form */}
                    {isRejectingThis && (
                      <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                        <Label htmlFor={`remarks-${leave.id}`} className="text-sm font-medium">
                          Rejection remarks <span className="text-muted-foreground">(optional)</span>
                        </Label>
                        <Textarea
                          id={`remarks-${leave.id}`}
                          value={rejectState.remarks}
                          onChange={(e) =>
                            setRejectState((prev) =>
                              prev ? { ...prev, remarks: e.target.value.slice(0, 200) } : prev
                            )
                          }
                          placeholder="Provide a reason for rejection..."
                          rows={3}
                          maxLength={200}
                          disabled={rejectState.saving}
                          className="resize-none text-sm"
                        />
                        <p className="text-xs text-muted-foreground text-right">
                          {rejectState.remarks.length}/200
                        </p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={handleRejectConfirm}
                            disabled={rejectState.saving}
                          >
                            <XCircle className="h-4 w-4 mr-1.5" />
                            {rejectState.saving ? "Rejecting…" : "Confirm Reject"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={cancelReject}
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
                          onClick={() => handleApprove(leave.id)}
                          disabled={isAnyActionRunning}
                        >
                          <CheckCircle className="h-4 w-4 mr-1.5" />
                          {isApprovingThis ? "Approving…" : "Approve"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-destructive text-destructive hover:bg-destructive/10"
                          onClick={() => openReject(leave.id)}
                          disabled={isAnyActionRunning}
                        >
                          <XCircle className="h-4 w-4 mr-1.5" />
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!isLoading && leaves.length > 0 && (
            <p className="text-xs text-muted-foreground pt-2">
              Only PENDING applications are shown here.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
