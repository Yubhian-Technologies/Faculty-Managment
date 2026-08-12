"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { formatDate, toDate } from "@/lib/utils";
import { Plus, ChevronRight, History } from "lucide-react";
import { LEAVE_REQUEST_STATUS_LABELS, EFFECTIVE_CATEGORY_LABELS, LEAVE_TYPE_LABELS } from "@/types/leave";
import type { EffectiveLeaveCategory, LeaveRequest, LeaveRequestStatus, LeaveTypeCode } from "@/types/leave";

export interface BalanceEntry {
  code: LeaveTypeCode;
  label: string;
  shortLabel: string;
  color: string;
  unlimited: boolean;
  entitled?: number;
  used?: number;
  pending?: number;
  remaining?: number;
  // Earned Leave only - see LeaveBalance.carriedForward. Already folded into
  // `entitled` above; kept separately so a "6 base + 3 carried" breakdown can
  // be shown (currently only on the EL history page - see LeaveTypeHistoryView).
  carriedForward?: number;
}

interface LeaveProfileViewProps {
  uid?: string; // omit to view the signed-in user's own leave profile
  // Omit when uid is set (viewing someone else's profile read-only, e.g.
  // Principal browsing a faculty member's history) - no Apply button then.
  applyHref?: string;
  // Base path for per-type history pages - e.g. "/panel/leave/history" links
  // to "/panel/leave/history/cl", "/panel/leave/history/od", etc. Every
  // balance card below is just an entry point into that page - there is no
  // inline history list here anymore, only the OD-style "View history" link.
  historyBaseHref: string;
}

const STATUS_VARIANT: Record<LeaveRequestStatus, "pending" | "approved" | "rejected" | "modified"> = {
  PENDING_HOD: "pending",
  PENDING_PRINCIPAL: "pending",
  PENDING_MANAGEMENT: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "modified",
};

export function LeaveProfileView({ uid, applyHref, historyBaseHref }: LeaveProfileViewProps) {
  const [effectiveCategory, setEffectiveCategory] = useState<EffectiveLeaveCategory | null>(null);
  const [balances, setBalances] = useState<BalanceEntry[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const qs = uid ? `?uid=${uid}` : "";

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [balRes, reqRes] = await Promise.all([
        fetch(`/api/leave/balances${qs}`),
        fetch(`/api/leave/applications${qs}`),
      ]);
      if (balRes.ok) {
        const data = (await balRes.json()) as { effectiveCategory: EffectiveLeaveCategory; leaveTypes: BalanceEntry[] };
        setEffectiveCategory(data.effectiveCategory);
        setBalances(data.leaveTypes);
      }
      if (reqRes.ok) {
        const data = (await reqRes.json()) as { requests: LeaveRequest[] };
        setRequests(data.requests ?? []);
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load leave profile" });
    } finally {
      setIsLoading(false);
    }
  }, [qs]);

  useEffect(() => {
    load();
  }, [load]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  const trackedBalances = balances.filter((b) => !b.unlimited);
  const odBalance = balances.find((b) => b.unlimited);

  // An APPROVED request that hasn't run its course yet - either ongoing right
  // now, or approved for a future date not yet taken. Either way it isn't
  // "completed", so the Apply button is disabled below (same as while a
  // request is still undecided) so a faculty member can't submit a new one
  // on top of it (the server enforces both too - see applications/route.ts
  // POST's hasPendingRequest/overlapsApprovedLeave).
  const today = new Date();
  const unfinishedApprovedLeave = requests.find((r) => {
    if (r.status !== "APPROVED") return false;
    const to = toDate(r.toDate);
    if (!to) return false;
    const toEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
    return toEnd >= today;
  });
  const isOngoingLeave = (() => {
    if (!unfinishedApprovedLeave) return false;
    const from = toDate(unfinishedApprovedLeave.fromDate);
    if (!from) return false;
    const fromStart = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    return fromStart <= today;
  })();
  const pendingRequest = requests.find(
    (r) => r.status === "PENDING_HOD" || r.status === "PENDING_PRINCIPAL" || r.status === "PENDING_MANAGEMENT"
  );
  const applyBlockedReason = unfinishedApprovedLeave
    ? isOngoingLeave
      ? "You're currently on approved leave"
      : "You have an upcoming approved leave that hasn't been completed yet"
    : pendingRequest
      ? "You already have a leave request pending approval"
      : null;

  // OD's count resets every calendar year, same as the tracked balances above
  // (the year comes from the request's fromDate, matching how HOD/Principal
  // approval commits a balance - see applications/[id]/route.ts). "Other" is
  // never balance-tracked and never resets - it's a running lifetime count.
  // Both only count APPROVED requests, not ones still pending decision.
  const currentYear = new Date().getFullYear();
  const odApprovedCount = requests.filter(
    (r) => r.leaveTypeCode === "OD" && r.status === "APPROVED" && toDate(r.fromDate)?.getFullYear() === currentYear
  ).length;
  const otherApprovedCount = requests.filter((r) => r.isOtherRequest && r.status === "APPROVED").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {effectiveCategory && <Badge variant="secondary">{EFFECTIVE_CATEGORY_LABELS[effectiveCategory]}</Badge>}
          {unfinishedApprovedLeave && (
            <Badge variant="in_progress">
              {isOngoingLeave ? "On leave" : "Leave scheduled"} &middot;{" "}
              {formatDate(unfinishedApprovedLeave.fromDate)} - {formatDate(unfinishedApprovedLeave.toDate)}
            </Badge>
          )}
        </div>
        {applyHref && (
          applyBlockedReason ? (
            <Button size="sm" disabled title={applyBlockedReason}>
              <Plus className="h-4 w-4 mr-1" />
              {unfinishedApprovedLeave ? (isOngoingLeave ? "On Leave" : "Leave Scheduled") : "Request Pending"}
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link href={applyHref}>
                <Plus className="h-4 w-4 mr-1" />
                Apply for Leave
              </Link>
            </Button>
          )
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {trackedBalances.map((b) => (
          <Link key={b.code} href={`${historyBaseHref}/${b.code.toLowerCase()}`}>
            <Card className="h-full hover:border-primary transition-colors">
              <CardContent className="p-4 flex flex-col justify-between h-full">
                <div>
                  <p className="text-sm text-muted-foreground">{b.label}</p>
                  {/* Earned Leave's balance is tracked the same as any other type
                      (see balanceEngine.ts) - just not shown here, per request. */}
                  {b.code !== "EL" && (
                    <>
                      <p className="text-3xl font-bold mt-1">{b.remaining}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        of {b.entitled}
                        {b.used ? ` · ${b.used} used` : ""}
                      </p>
                    </>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                  View history <ChevronRight className="h-3.5 w-3.5" />
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}

        {odBalance && (
          <Link href={`${historyBaseHref}/od`}>
            <Card className="h-full hover:border-primary transition-colors">
              <CardContent className="p-4 flex flex-col justify-between h-full">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">{odBalance.label}</p>
                  <CountBadge count={odApprovedCount} title={`${odApprovedCount} approved this year`} />
                </div>
                <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                  View history <ChevronRight className="h-3.5 w-3.5" />
                </p>
              </CardContent>
            </Card>
          </Link>
        )}

        {/* "Other" is a catch-all reason, not a balance-tracked LeaveTypeCode
            (see types/leave.ts) - it's never in the balances response, so
            unlike the cards above this one is always shown rather than
            derived from `balances`. */}
        <Link href={`${historyBaseHref}/other`}>
          <Card className="h-full hover:border-primary transition-colors">
            <CardContent className="p-4 flex flex-col justify-between h-full">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">Other</p>
                <CountBadge count={otherApprovedCount} title={`${otherApprovedCount} approved (all-time)`} />
              </div>
              <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                View history <ChevronRight className="h-3.5 w-3.5" />
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <Link href={`${historyBaseHref}/all`}>
        <Card className="hover:border-primary transition-colors">
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <History className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">View Full Leave History</p>
                <p className="text-xs text-muted-foreground">Every request you&apos;ve made, across all leave types, latest first</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}

// Small "N approved" digit chip for the OD/Other cards, which - unlike the
// tracked balance cards - have no entitled/remaining numbers of their own.
function CountBadge({ count, title }: { count: number; title: string }) {
  return (
    <span
      title={title}
      className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-semibold text-foreground"
    >
      {count}
    </span>
  );
}

const CANCELLABLE_STATUSES: LeaveRequestStatus[] = ["PENDING_HOD", "PENDING_PRINCIPAL", "PENDING_MANAGEMENT"];

export function LeaveHistoryRow({
  request,
  onCancel,
  cancelling,
}: {
  request: LeaveRequest;
  // Omitted entirely when viewing someone else's history (e.g. an HOD
  // browsing a faculty member's) - the server only lets the original
  // requester cancel their own request anyway (see applications/[id]/route.ts
  // PATCH's CANCEL branch), so the button isn't offered there at all.
  onCancel?: (request: LeaveRequest) => void;
  cancelling?: boolean;
}) {
  const canCancel = !!onCancel && CANCELLABLE_STATUSES.includes(request.status);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {request.isOtherRequest && !request.leaveTypeCode ? "Other" : LEAVE_TYPE_LABELS[request.leaveTypeCode!] ?? request.leaveTypeCode}
          <span className="text-muted-foreground font-normal"> &middot; {request.totalDays} day(s)</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {formatDate(request.fromDate)} - {formatDate(request.toDate)}
        </p>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{request.reason}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {request.isPaidLeave !== undefined && (
          <Badge variant={request.isPaidLeave ? "approved" : "modified"}>
            {request.isPaidLeave ? "Paid" : "Unpaid"}
          </Badge>
        )}
        {!!request.lopDays && (
          <>
            <Badge variant="rejected">Extra: {request.lopDays}d</Badge>
            <Badge variant="rejected">-{request.lopDays}x</Badge>
          </>
        )}
        <Badge variant={STATUS_VARIANT[request.status]}>{LEAVE_REQUEST_STATUS_LABELS[request.status]}</Badge>
        {canCancel && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            disabled={cancelling}
            loading={cancelling}
            onClick={() => onCancel!(request)}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
