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

interface BalanceEntry {
  code: LeaveTypeCode;
  label: string;
  shortLabel: string;
  color: string;
  unlimited: boolean;
  entitled?: number;
  used?: number;
  pending?: number;
  remaining?: number;
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
        {effectiveCategory && <Badge variant="secondary">{EFFECTIVE_CATEGORY_LABELS[effectiveCategory]}</Badge>}
        {applyHref && (
          <Button asChild size="sm">
            <Link href={applyHref}>
              <Plus className="h-4 w-4 mr-1" />
              Apply for Leave
            </Link>
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {trackedBalances.map((b) => (
          <Link key={b.code} href={`${historyBaseHref}/${b.code.toLowerCase()}`}>
            <Card className="h-full hover:border-primary transition-colors">
              <CardContent className="p-4 flex flex-col justify-between h-full">
                <div>
                  <p className="text-sm text-muted-foreground">{b.label}</p>
                  <p className="text-3xl font-bold mt-1">{b.remaining}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    of {b.entitled}
                    {b.used ? ` · ${b.used} used` : ""}
                  </p>
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

export function LeaveHistoryRow({ request }: { request: LeaveRequest }) {
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
      </div>
    </div>
  );
}
