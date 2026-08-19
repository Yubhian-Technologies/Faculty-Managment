"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { ArrowLeft, History } from "lucide-react";
import { LeaveHistoryRow, type BalanceEntry } from "./LeaveProfileView";
import { AdjustCoverageDialog } from "./AdjustCoverageDialog";
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
  SH: "All Summer Vacation requests - no annual limit",
  OTHER: 'All "Other" leave requests',
  ALL: "Every leave request you've made, across all types - latest first",
};

export function parseLeaveHistoryFilter(raw: string): LeaveHistoryFilter | null {
  const upper = raw.toUpperCase();
  if (upper === "OTHER" || upper === "ALL") return upper;
  return (["CL", "SL", "SCL", "EL", "OD", "SH"] as const).includes(upper as LeaveTypeCode)
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
  // HOD's own department, or Principal-tier, browsing someone else's
  // history (uid set) - lets them revisit an already-APPROVED request and
  // re-pick coverage (see AdjustCoverageDialog). Not offered on the
  // requester's own view of their own history, nor on College Office's
  // (server-side ADJUST_COVERAGE is HOD/Principal-tier only - see
  // applications/[id]/route.ts).
  canAdjustCoverage?: boolean;
}

// Filtered, single-type leave history - reached by clicking a leave type's
// balance card (or the grouped "Leave History" section) on LeaveProfileView.
// Same component drives every leave type across every role's "My Leave" page.
export function LeaveTypeHistoryView({ uid, backHref, type, showOtherLeaveCategory, canAdjustCoverage }: LeaveTypeHistoryViewProps) {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [categories, setCategories] = useState<Record<string, OtherLeaveCategory>>({});
  // A cancel here just flips the request to CANCELLED - it stays in this same
  // history list (per request), it just moves out of the pending stage. The
  // balance is untouched: nothing is ever reserved at submission (see
  // applications/route.ts POST), so releasing a pending amount that was never
  // added releases nothing - cancelling never reduces the shown balance.
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<LeaveRequest | null>(null);
  // Earned Leave's carry-forward breakdown (e.g. "6 base + 3 carried from
  // last year = 9") - fetched only for the EL history view specifically per
  // request; every other tab (the main balance-card grid, Apply for Leave's
  // type picker, etc.) shows nothing extra for it.
  const [elBalance, setElBalance] = useState<BalanceEntry | null>(null);

  const label = type === "ALL" ? "Full" : type === "OTHER" ? "Other" : LEAVE_TYPE_LABELS[type];

  useEffect(() => {
    if (type !== "EL") return;
    const qs = uid ? `?uid=${uid}` : "";
    fetch(`/api/leave/balances${qs}`)
      .then((r) => r.json() as Promise<{ leaveTypes: BalanceEntry[] }>)
      .then((data) => setElBalance((data.leaveTypes ?? []).find((b) => b.code === "EL") ?? null))
      .catch(() => {}); // purely informational - the request list below still loads fine either way
  }, [type, uid]);

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

  async function handleCancel() {
    if (!cancelTarget || !cancelReason.trim()) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/leave/applications/${cancelTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CANCEL", reason: cancelReason.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to cancel");
      toast({ variant: "success", title: "Leave request cancelled" });
      setRequests((prev) =>
        prev.map((r) => (r.id === cancelTarget.id ? { ...r, status: "CANCELLED", cancelReason: cancelReason.trim() } : r))
      );
      setCancelTarget(null);
      setCancelReason("");
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to cancel" });
    } finally {
      setCancelling(false);
    }
  }

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

      {type === "EL" && elBalance && !!elBalance.carriedForward && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4 text-sm">
            <p className="font-medium">
              {elBalance.entitled} day(s) available &mdash; total Earned Leave, carried forward every year
            </p>
            <p className="text-muted-foreground mt-0.5">
              {(elBalance.entitled ?? 0) - elBalance.carriedForward} new this year + {elBalance.carriedForward} carried
              forward from previous years (capped at 300 total)
              {elBalance.used ? ` · ${elBalance.used} used so far` : ""}
            </p>
          </CardContent>
        </Card>
      )}

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
                  // Only offer cancelling one's own requests - viewing someone
                  // else's history (uid set) is read-only.
                  onCancel={uid ? undefined : (target) => setCancelTarget(target)}
                  cancelling={cancelling && cancelTarget?.id === r.id}
                  onAdjustCoverage={canAdjustCoverage ? (target) => setAdjustTarget(target) : undefined}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(open) => { if (!open) { setCancelTarget(null); setCancelReason(""); } }}
        title="Cancel this leave request?"
        description={
          cancelTarget?.status === "APPROVED"
            ? "It moves to Cancelled in your history and the days already deducted for it are added back to your balance."
            : "It moves to Cancelled in your history. Your leave balance is unaffected either way."
        }
        confirmLabel="Cancel Request"
        variant="destructive"
        loading={cancelling}
        confirmDisabled={!cancelReason.trim()}
        onConfirm={() => void handleCancel()}
      >
        <div className="space-y-1.5">
          <Label htmlFor="cancel-reason">Reason for cancelling (visible to your approver)</Label>
          <Textarea
            id="cancel-reason"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            rows={3}
            placeholder="Why are you cancelling this leave request?"
          />
        </div>
      </ConfirmDialog>

      <AdjustCoverageDialog
        request={adjustTarget}
        onOpenChange={(open) => { if (!open) setAdjustTarget(null); }}
        onUpdated={(id, periodSubstitutions) =>
          setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, periodSubstitutions } : r)))
        }
      />
    </div>
  );
}
