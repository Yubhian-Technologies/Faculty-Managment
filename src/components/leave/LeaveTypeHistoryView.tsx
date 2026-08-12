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
import { LEAVE_TYPE_LABELS, OTHER_LEAVE_CATEGORY_LABELS } from "@/types/leave";
import type { LeaveRequest, LeaveTypeCode, OtherLeaveCategory } from "@/types/leave";

// "OTHER" isn't a real LeaveTypeCode (see types/leave.ts) - it's the catch-all
// bucket for isOtherRequest submissions, which never get a leaveTypeCode.
// "ALL" isn't a leave type either - it's the unfiltered, every-type view
// reached from the "View Full Leave History" entry on LeaveProfileView.
export type LeaveHistoryFilter = LeaveTypeCode | "OTHER" | "ALL";

const DESCRIPTIONS: Record<LeaveHistoryFilter, string> = {
  CL: "All Casual Leave requests",
  SL: "All Sick Leave requests",
  SCL: "All Special Casual Leave requests",
  EL: "All Earned Leave requests",
  OD: "All On Duty requests - no annual limit",
  OTHER: 'All "Other" leave requests',
  ALL: "Every leave request you've made, across all types - latest first",
};

export function parseLeaveHistoryFilter(raw: string): LeaveHistoryFilter | null {
  const upper = raw.toUpperCase();
  if (upper === "OTHER" || upper === "ALL") return upper;
  return (["CL", "SL", "SCL", "EL", "OD"] as const).includes(upper as LeaveTypeCode)
    ? (upper as LeaveTypeCode)
    : null;
}

interface LeaveTypeHistoryViewProps {
  uid?: string; // omit to view the signed-in user's own history
  backHref: string;
  type: LeaveHistoryFilter;
  // Principal/VP's own Staff Leave History pages only - see
  // OtherLeaveCategory in src/types/leave.ts. Every other caller of this
  // same component (every role's own "My Leave", HOD's staff view) omits
  // this, so the category never even gets fetched there, let alone shown.
  showOtherLeaveCategory?: boolean;
}

// Filtered, single-type leave history - reached by clicking a leave type's
// balance card (or the grouped "Leave History" section) on LeaveProfileView.
// Same component drives every leave type across every role's "My Leave" page.
export function LeaveTypeHistoryView({ uid, backHref, type, showOtherLeaveCategory }: LeaveTypeHistoryViewProps) {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [categories, setCategories] = useState<Record<string, OtherLeaveCategory>>({});

  const label = type === "ALL" ? "Full" : type === "OTHER" ? "Other" : LEAVE_TYPE_LABELS[type];

  useEffect(() => {
    const qs = uid ? `?uid=${uid}` : "";
    fetch(`/api/leave/applications${qs}`)
      .then((r) => r.json() as Promise<{ requests: LeaveRequest[] }>)
      .then((data) => {
        // Already sorted newest-first by the API (sortByCreatedAtDesc) - the
        // "ALL" view relies on that ordering as-is, latest request on top.
        const all = data.requests ?? [];
        const filtered =
          type === "ALL"
            ? all
            : type === "OTHER"
              ? all.filter((r) => r.isOtherRequest)
              : all.filter((r) => r.leaveTypeCode === type);
        setRequests(filtered);
      })
      .catch(() => toast({ variant: "destructive", title: `Failed to load ${label} history` }))
      .finally(() => setIsLoading(false));
  }, [uid, type, label]);

  useEffect(() => {
    if (!showOtherLeaveCategory) return;
    const qs = uid ? `?uid=${uid}` : "";
    fetch(`/api/leave/other-categories${qs}`)
      .then((r) => r.json() as Promise<{ categories?: Record<string, OtherLeaveCategory> }>)
      .then((d) => setCategories(d.categories ?? {}))
      .catch(() => { /* non-critical - rows just render without the category badge */ });
  }, [uid, showOtherLeaveCategory]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={type === "ALL" ? "Full Leave History" : `${label} History`}
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
            // The "ALL" view stays single-column so the newest-first order
            // reads unambiguously top-to-bottom; per-type lists are short
            // enough that a 2-up grid stays readable.
            <div className={type === "ALL" ? "flex flex-col gap-3" : "grid grid-cols-1 sm:grid-cols-2 gap-3"}>
              {requests.map((r) => (
                <LeaveHistoryRow
                  key={r.id}
                  request={r}
                  categoryLabel={categories[r.id] ? OTHER_LEAVE_CATEGORY_LABELS[categories[r.id]] : undefined}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
