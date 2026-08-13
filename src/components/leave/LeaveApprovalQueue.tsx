"use client";

import { useEffect, useState, useCallback } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Avatar } from "@/components/shared/Avatar";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { cn, formatDate } from "@/lib/utils";
import { CalendarClock, Check, X, ChevronDown, ChevronUp } from "lucide-react";
import { EFFECTIVE_CATEGORY_LABELS, EFFECTIVE_CATEGORY_ORDER, LEAVE_TYPE_LABELS, OTHER_LEAVE_CATEGORY_LABELS, OTHER_LEAVE_CATEGORY_ORDER } from "@/types/leave";
import type { EffectiveLeaveCategory, LeaveRequest, OtherLeaveCategory } from "@/types/leave";

const CATEGORY_TABS = EFFECTIVE_CATEGORY_ORDER.map((key) => ({ key, label: EFFECTIVE_CATEGORY_LABELS[key] }));

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
  const [categoryById, setCategoryById] = useState<Record<string, OtherLeaveCategory>>({});
  const [actingId, setActingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [category, setCategory] = useState<EffectiveLeaveCategory>("vacation");

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
    const isPrincipalOtherDecision = r.status === "PENDING_PRINCIPAL" && !!r.isOtherRequest;
    if (action === "APPROVE" && isHodOtherDecision && paidById[r.id] === undefined) {
      toast({ variant: "destructive", title: "Select whether this is paid or unpaid leave" });
      return;
    }
    if (action === "APPROVE" && isPrincipalOtherDecision && categoryById[r.id] === undefined) {
      toast({ variant: "destructive", title: "Select a leave category before approving" });
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
          otherLeaveCategory: isPrincipalOtherDecision ? categoryById[r.id] : undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Action failed");
      toast({
        variant: "success",
        title: action === "REJECT" ? "Request rejected" : isHodOtherDecision ? "Forwarded to Principal" : "Request approved",
      });
      setRequests((prev) => prev.filter((req) => req.id !== r.id));
      setExpandedId((prev) => (prev === r.id ? null : prev));
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Action failed" });
    } finally {
      setActingId(null);
    }
  }

  const visibleRequests = requests.filter((r) => r.category === category);

  return (
    <div className="space-y-4">
      <SegmentedTabs value={category} onChange={(key) => setCategory(key as EffectiveLeaveCategory)} options={CATEGORY_TABS} />

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : visibleRequests.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-6 w-6" />}
          title={requests.length === 0 ? "No pending leave requests" : `No pending requests from ${EFFECTIVE_CATEGORY_LABELS[category]}`}
        />
      ) : (
        <div className="space-y-2.5">
          {visibleRequests.map((r) => {
            const isOtherRequest = !!r.isOtherRequest;
            const isHodOtherDecision = r.status === "PENDING_HOD" && isOtherRequest;
            const isPrincipalOtherDecision = r.status === "PENDING_PRINCIPAL" && isOtherRequest;
            const isExpanded = expandedId === r.id;
            return (
              <Card key={r.id} className={cn("transition-colors", isExpanded && "ring-1 ring-primary/20")}>
                <CardHeader
                  className="p-4 cursor-pointer select-none"
                  onClick={() => setExpandedId(isExpanded ? null : r.id)}
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={r.employeeName} size="sm" />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold leading-tight">{r.employeeName}</p>
                        {r.department && (
                          <Badge variant="outline" className="capitalize text-[10px] px-1.5 py-0">
                            {r.department}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {formatDate(r.fromDate)} - {formatDate(r.toDate)} &middot; {r.totalDays} day{r.totalDays === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="secondary">
                        {isOtherRequest ? "Other" : LEAVE_TYPE_LABELS[r.leaveTypeCode!]}
                      </Badge>
                      {r.extendsRequestId && (
                        <Badge variant="outline" title="This extends a leave that was already approved">
                          Extension
                        </Badge>
                      )}
                      {isOtherRequest && !isHodOtherDecision && r.isPaidLeave !== undefined && (
                        <Badge variant={r.isPaidLeave ? "approved" : "modified"}>
                          {r.isPaidLeave ? "Paid" : "Unpaid"}
                        </Badge>
                      )}
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="px-4 pb-4 pt-0 space-y-3 border-t">
                    <div className="space-y-1.5 pt-3">
                      <label className="text-xs text-muted-foreground">Reason</label>
                      <p className="text-sm">{r.reason || <span className="text-muted-foreground italic">No reason provided</span>}</p>
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

                    {isPrincipalOtherDecision && (
                      <div className="max-w-xs space-y-1.5">
                        <label className="text-xs text-muted-foreground">Leave category (required to approve)</label>
                        <Select
                          value={categoryById[r.id] ?? ""}
                          onValueChange={(v) => setCategoryById((prev) => ({ ...prev, [r.id]: v as OtherLeaveCategory }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                          <SelectContent>
                            {OTHER_LEAVE_CATEGORY_ORDER.map((c) => (
                              <SelectItem key={c} value={c}>{OTHER_LEAVE_CATEGORY_LABELS[c]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] text-muted-foreground">Only visible in your own Staff Leave History - never shown to the requester, their HOD, or anyone else.</p>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Remarks (optional)</label>
                      <Textarea
                        placeholder="Add a note for this decision..."
                        rows={2}
                        className="resize-none text-sm"
                        value={remarksById[r.id] ?? ""}
                        onChange={(e) => setRemarksById((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      />
                    </div>

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
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
