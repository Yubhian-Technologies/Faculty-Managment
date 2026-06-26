import { Badge } from "@/components/ui/badge";
import { WORKFLOW_STATUS_LABELS } from "@/types";
import type { WorkflowStatus, CandidateStatus } from "@/types";
import { cn } from "@/lib/utils";

type Status = WorkflowStatus | CandidateStatus | string;

const variantMap: Record<string, string> = {
  PENDING: "pending",
  PENDING_HR: "pending",
  PENDING_ADMIN: "modified",
  APPROVED: "approved",
  REJECTED: "rejected",
  MODIFIED: "modified",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  WAITLISTED: "waitlisted",
  SHORTLISTED: "in_progress",
  SELECTED: "approved",
  OFFER_PENDING: "modified",
  OFFER_SENT: "completed",
  ARRIVED: "approved",
};

interface StatusBadgeProps {
  status: Status;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const variant = (variantMap[status] ?? "default") as Parameters<typeof Badge>[0]["variant"];
  const label = WORKFLOW_STATUS_LABELS[status as WorkflowStatus] ?? status;

  return (
    <Badge variant={variant} className={cn("capitalize", className)}>
      {label}
    </Badge>
  );
}
