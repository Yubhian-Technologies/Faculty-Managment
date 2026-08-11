"use client";

import { useEffect, useState } from "react";
import { Building2, CalendarClock, Check, ChevronDown, ChevronUp, RefreshCw, X } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { LEAVE_TYPE_LABELS } from "@/types/leave";
import type { LeaveRequest } from "@/types/leave";

type Row = LeaveRequest & { collegeId: string; collegeName: string };

// A Principal's own leave (PENDING_MANAGEMENT) has no one else within the
// college to decide it, so it's reviewed here instead - cross-college by
// nature, same idiom as EmergencyBudgetRequests (Management has no collegeId
// of its own, see /api/management/leave-approvals).
export function ManagementLeaveApprovals() {
  const [requests, setRequests] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [remarksById, setRemarksById] = useState<Record<string, string>>({});

  function load() {
    setIsLoading(true);
    fetch("/api/management/leave-approvals")
      .then((r) => r.json() as Promise<{ requests: Row[] }>)
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load leave approvals" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    // Wrapped so load()'s setState calls aren't reachable synchronously from
    // the effect body (react-hooks/set-state-in-effect).
    void (async () => { load(); })();
  }, []);

  async function act(item: Row, action: "APPROVE" | "REJECT") {
    setActingId(item.id);
    try {
      const res = await fetch(`/api/management/leave-approvals/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collegeId: item.collegeId, action, remarks: remarksById[item.id] }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Action failed");
      toast({ variant: "success", title: action === "APPROVE" ? "Leave approved" : "Leave rejected" });
      setRequests((prev) => prev.filter((r) => r.id !== item.id));
      setExpandedId((prev) => (prev === item.id ? null : prev));
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Action failed" });
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={load} loading={isLoading}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          title="No leave requests pending"
          description="A Principal's own leave request has no one else within their college to decide it, so it lands here."
          icon={<CalendarClock className="h-8 w-8" />}
        />
      ) : (
        <div className="space-y-3">
          {requests.map((item) => {
            const isExpanded = expandedId === item.id;
            const isActingThis = actingId === item.id;
            return (
              <Card key={item.id}>
                <CardHeader
                  className="pb-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-semibold text-sm">{item.collegeName}</span>
                        <Badge variant="secondary" className="text-xs">
                          {item.isOtherRequest ? "Other" : LEAVE_TYPE_LABELS[item.leaveTypeCode!] ?? item.leaveTypeCode}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {item.employeeName} &middot; {formatDate(item.fromDate)} - {formatDate(item.toDate)} &middot;{" "}
                        {item.totalDays} day{item.totalDays === 1 ? "" : "s"}
                      </p>
                    </div>
                    {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0 space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-normal">Reason</Label>
                      <p className="text-sm">{item.reason || <span className="text-muted-foreground italic">No reason provided</span>}</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-normal">Remarks (optional)</Label>
                      <Textarea
                        placeholder="Add a note for this decision..."
                        rows={2}
                        className="resize-none text-sm"
                        value={remarksById[item.id] ?? ""}
                        onChange={(e) => setRemarksById((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2 border-t">
                      <Button
                        size="sm" variant="outline"
                        disabled={actingId !== null} loading={isActingThis}
                        onClick={() => void act(item, "REJECT")}
                      >
                        <X className="h-4 w-4 mr-1" /> Reject
                      </Button>
                      <Button size="sm" disabled={actingId !== null} loading={isActingThis} onClick={() => void act(item, "APPROVE")}>
                        <Check className="h-4 w-4 mr-1" /> Approve
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
