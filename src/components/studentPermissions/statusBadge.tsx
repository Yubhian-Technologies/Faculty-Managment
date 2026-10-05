import { Badge } from "@/components/ui/badge";
import type { RequestStatus } from "@/lib/approvals/types";
import { currentStage } from "@/lib/approvals/stateMachine";
import { PERMISSION_STAGE_LABELS, type PermissionStage } from "@/lib/studentPermissions/types";
import type { PermissionRequestView } from "./api";

const LABEL: Record<RequestStatus, string> = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Withdrawn", REVOKED: "Revoked" };
const VARIANT: Record<RequestStatus, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "outline", APPROVED: "default", REJECTED: "destructive", CANCELLED: "secondary", REVOKED: "secondary",
};

export function stageLabel(stage: string): string {
  return PERMISSION_STAGE_LABELS[stage as PermissionStage] ?? stage;
}

export function StatusBadge({ request }: { request: Pick<PermissionRequestView, "status" | "chain" | "stageIndex"> }) {
  const stage = currentStage(request);
  return <Badge variant={VARIANT[request.status]}>{request.status === "PENDING" && stage ? `Awaiting ${stageLabel(stage)}` : LABEL[request.status]}</Badge>;
}

export const formatRange = (from: string, to: string) => (from === to ? from : `${from} → ${to}`);
export const formatPeriods = (p: "ALL" | number[]) => (p === "ALL" ? "All periods" : `Period${p.length > 1 ? "s" : ""} ${p.join(", ")}`);
