"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { ArrowLeft, History } from "lucide-react";
import { LeaveHistoryRow } from "./LeaveProfileView";
import { LEAVE_TYPE_LABELS } from "@/types/leave";
import type { LeaveRequest, LeaveTypeCode } from "@/types/leave";

// "OTHER" isn't a real LeaveTypeCode (see types/leave.ts) - it's the catch-all
// bucket for isOtherRequest submissions, which never get a leaveTypeCode.
export type LeaveHistoryFilter = LeaveTypeCode | "OTHER";

const DESCRIPTIONS: Record<LeaveHistoryFilter, string> = {
  CL: "All Casual Leave requests",
  SL: "All Sick Leave requests",
  SCL: "All Special Casual Leave requests",
  EL: "All Earned Leave requests",
  OD: "All On Duty requests - no annual limit",
  OTHER: 'All "Other" leave requests',
};

export function parseLeaveHistoryFilter(raw: string): LeaveHistoryFilter | null {
  const upper = raw.toUpperCase();
  if (upper === "OTHER") return "OTHER";
  return (["CL", "SL", "SCL", "EL", "OD"] as const).includes(upper as LeaveTypeCode)
    ? (upper as LeaveTypeCode)
    : null;
}

interface LeaveTypeHistoryViewProps {
  uid?: string; // omit to view the signed-in user's own history
  backHref: string;
  type: LeaveHistoryFilter;
}

// Filtered, single-type leave history - reached by clicking a leave type's
// balance card (or the grouped "Leave History" section) on LeaveProfileView.
// Same component drives every leave type across every role's "My Leave" page.
export function LeaveTypeHistoryView({ uid, backHref, type }: LeaveTypeHistoryViewProps) {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const label = type === "OTHER" ? "Other" : LEAVE_TYPE_LABELS[type];

  useEffect(() => {
    const qs = uid ? `?uid=${uid}` : "";
    fetch(`/api/leave/applications${qs}`)
      .then((r) => r.json() as Promise<{ requests: LeaveRequest[] }>)
      .then((data) => {
        const all = data.requests ?? [];
        const filtered = type === "OTHER"
          ? all.filter((r) => r.isOtherRequest)
          : all.filter((r) => r.leaveTypeCode === type);
        setRequests(filtered);
      })
      .catch(() => toast({ variant: "destructive", title: `Failed to load ${label} history` }))
      .finally(() => setIsLoading(false));
  }, [uid, type, label]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${label} History`}
        description={DESCRIPTIONS[type]}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={backHref}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Leave Profile
            </Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : requests.length === 0 ? (
            <EmptyState icon={<History className="h-6 w-6" />} title={`No ${label} requests yet`} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
