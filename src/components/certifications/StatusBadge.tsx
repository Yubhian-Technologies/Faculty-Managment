import { CheckCircle2, CircleDashed, Clock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CertificateRequestStatus } from "@/types";

// A rounded-md status chip, deliberately not the shared pill-shaped Badge -
// the certificate flow reads as a sequence of stages, and an icon + square
// chip matches the stepper (CertificateProgress) it sits beside better than
// a rounded-full label would.

const LABEL: Record<CertificateRequestStatus, string> = {
  IN_PROGRESS: "In Progress",
  PENDING_ISSUANCE: "Ready for Issuance",
  ISSUED: "Issued",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

const ICON: Record<CertificateRequestStatus, typeof Clock> = {
  IN_PROGRESS: Clock,
  PENDING_ISSUANCE: Clock,
  ISSUED: CheckCircle2,
  REJECTED: XCircle,
  CANCELLED: CircleDashed,
};

const CLASS: Record<CertificateRequestStatus, string> = {
  IN_PROGRESS: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900",
  PENDING_ISSUANCE: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900",
  ISSUED: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900",
  REJECTED: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({ status }: { status: CertificateRequestStatus }) {
  const Icon = ICON[status];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-semibold", CLASS[status])}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {LABEL[status]}
    </span>
  );
}
