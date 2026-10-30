import { Badge } from "@/components/ui/badge";
import type { RequestStatus } from "@/lib/approvals/types";
import { currentStage } from "@/lib/approvals/stateMachine";
import {
  PERMISSION_STAGE_LABELS,
  type PermissionStage,
} from "@/lib/studentPermissions/types";
import type { PermissionRequestView } from "./api";

// One consistent status treatment for every list and card in the module. Colors
// match the app's status conventions (yellow = waiting, green = approved, red =
// rejected, secondary = withdrawn/revoked) and always say WHO is next, not just
// "Pending".

const LABEL: Record<RequestStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Withdrawn",
  REVOKED: "Revoked",
};

const TREATMENT: Record<RequestStatus, { className: string; label?: string }> =
  {
    PENDING: { className: "border-amber-200 bg-amber-50 text-amber-800" },
    APPROVED: {
      className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    },
    REJECTED: { className: "border-red-200 bg-red-50 text-red-800" },
    CANCELLED: { className: "", label: "Withdrawn" },
    REVOKED: { className: "", label: "Revoked" },
  };

export function stageLabel(stage: string): string {
  return PERMISSION_STAGE_LABELS[stage as PermissionStage] ?? stage;
}

export function StatusBadge({
  request,
}: {
  request: Pick<PermissionRequestView, "status" | "chain" | "stageIndex">;
}) {
  const stage = currentStage(request);
  const t = TREATMENT[request.status];
  return (
    <Badge
      variant={
        request.status === "PENDING" ||
        request.status === "APPROVED" ||
        request.status === "REJECTED"
          ? "outline"
          : "secondary"
      }
      className={`text-xs rounded-md ${t.className}`}
    >
      {request.status === "PENDING" && stage
        ? `Awaiting ${stageLabel(stage)}`
        : (t.label ?? LABEL[request.status])}
    </Badge>
  );
}

export const formatRange = (from: string, to: string) =>
  from === to ? from : `${from} → ${to}`;
export const formatPeriods = (p: "ALL" | number[]) =>
  p === "ALL"
    ? "All periods"
    : `Period${p.length > 1 ? "s" : ""} ${p.join(", ")}`;

// Loading placeholder shared by every list so module screens load consistently.
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading requests">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border bg-card p-4 space-y-2.5 animate-pulse"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-2 flex-1">
              <div className="h-4 w-1/3 rounded bg-muted" />
              <div className="h-3 w-1/2 rounded bg-muted/70" />
            </div>
            <div className="h-5 w-20 rounded-full bg-muted" />
          </div>
          <div className="h-3 w-3/4 rounded bg-muted/70" />
        </div>
      ))}
    </div>
  );
}

// Empty state shared by every list: an icon, a headline, and an optional hint.
export function EmptyState({
  icon: Icon,
  headline,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  headline: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed bg-card px-4 py-8 text-center sm:p-10" role="status">
      <Icon
        className="w-10 h-10 mx-auto mb-2 text-muted-foreground/60"
        aria-hidden
      />
      <p className="text-sm font-medium text-foreground">{headline}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

// Error state shared by every list, with a retry affordance.
export function LoadError({
  message,
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="rounded-xl border border-red-200 bg-red-50 p-6 text-center"
      role="alert"
    >
      <p className="text-sm font-medium text-red-800">
        Couldn&apos;t load requests.
      </p>
      {message && <p className="text-xs text-red-700 mt-1">{message}</p>}
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 inline-flex min-h-11 items-center rounded px-3 text-sm text-red-800 underline underline-offset-2 hover:text-red-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 sm:min-h-8"
      >
        Try again
      </button>
    </div>
  );
}
