import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { INDENT_STATUS_LABELS, type IndentStatus } from "@/types";

const STATUS_STYLES: Record<IndentStatus, string> = {
  PENDING_PURCHASE_REVIEW: "bg-yellow-100 text-yellow-800 border-yellow-200",
  REJECTED_BY_PURCHASE: "bg-red-100 text-red-800 border-red-200",
  RETURNED_TO_HOD: "bg-orange-100 text-orange-800 border-orange-200",
  PENDING_FINANCE_REVIEW: "bg-blue-100 text-blue-800 border-blue-200",
  RETURNED_TO_PURCHASE: "bg-orange-100 text-orange-800 border-orange-200",
  REJECTED: "bg-red-100 text-red-800 border-red-200",
  APPROVED: "bg-green-100 text-green-800 border-green-200",
};

export function IndentStatusBadge({ status, className }: { status: IndentStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("text-xs", STATUS_STYLES[status], className)}>
      {INDENT_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
