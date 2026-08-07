"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { CalendarClock, Plus, ChevronRight } from "lucide-react";
import { LEAVE_REQUEST_STATUS_LABELS, EFFECTIVE_CATEGORY_LABELS } from "@/types/leave";
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
  applyHref: string;
  odHistoryHref: string;
}

const STATUS_VARIANT: Record<LeaveRequestStatus, "pending" | "approved" | "rejected" | "modified"> = {
  PENDING_HOD: "pending",
  PENDING_PRINCIPAL: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "modified",
};

export function LeaveProfileView({ uid, applyHref, odHistoryHref }: LeaveProfileViewProps) {
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
        setRequests(data.requests);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        {effectiveCategory && <Badge variant="secondary">{EFFECTIVE_CATEGORY_LABELS[effectiveCategory]}</Badge>}
        <Button asChild size="sm">
          <Link href={applyHref}>
            <Plus className="h-4 w-4 mr-1" />
            Apply for Leave
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {trackedBalances.map((b) => (
          <Card key={b.code}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{b.label}</p>
              <p className="text-3xl font-bold mt-1">{b.remaining}</p>
              <p className="text-xs text-muted-foreground mt-1">
                of {b.entitled}
                {b.used ? ` · ${b.used} used` : ""}
                {b.pending ? ` · ${b.pending} pending` : ""}
              </p>
            </CardContent>
          </Card>
        ))}

        {odBalance && (
          <Link href={odHistoryHref}>
            <Card className="h-full hover:border-primary transition-colors">
              <CardContent className="p-4 flex flex-col justify-between h-full">
                <p className="text-sm text-muted-foreground">{odBalance.label}</p>
                <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                  View history <ChevronRight className="h-3.5 w-3.5" />
                </p>
              </CardContent>
            </Card>
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Leave History</CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <EmptyState icon={<CalendarClock className="h-6 w-6" />} title="No leave requests yet" />
          ) : (
            <div className="space-y-2">
              {requests.map((r) => (
                <LeaveHistoryRow key={r.id} request={r} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function LeaveHistoryRow({ request }: { request: LeaveRequest }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {request.isOtherRequest && !request.leaveTypeCode ? "Other" : request.leaveTypeCode}
          <span className="text-muted-foreground font-normal"> &middot; {request.totalDays} day(s)</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {formatDate(request.fromDate)} - {formatDate(request.toDate)}
        </p>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{request.reason}</p>
      </div>
      <Badge variant={STATUS_VARIANT[request.status]}>{LEAVE_REQUEST_STATUS_LABELS[request.status]}</Badge>
    </div>
  );
}
