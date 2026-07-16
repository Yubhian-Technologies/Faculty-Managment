"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatDateTime } from "@/lib/utils";
import { FINANCE_AUDIT_ACTION_LABELS } from "@/types";
import type { FinanceAuditLog } from "@/types";

type Row = FinanceAuditLog & Record<string, unknown>;

export default function FinanceAuditPage() {
  const [logs, setLogs] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    collegeFetch("/api/college/finance-audit-logs")
      .then((r) => r.json() as Promise<{ logs: Row[] }>)
      .then((d) => setLogs(d.logs ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load audit logs" }))
      .finally(() => setIsLoading(false));
  }, []);

  const columns: Column<Row>[] = [
    { key: "timestamp", header: "Timestamp", render: (row) => formatDateTime(row.timestamp) },
    {
      key: "action", header: "Action",
      render: (row) => <Badge variant="secondary">{FINANCE_AUDIT_ACTION_LABELS[row.action] ?? row.action}</Badge>,
    },
    { key: "performedByName", header: "Performed By" },
    { key: "targetId", header: "Target", hideOnMobile: true, render: (row) => row.targetId ?? "—" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit & Compliance"
        description="Financial audit trail — every budget, approval, payment, and clearance action"
      />

      <DataTable
        data={logs}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Search by name..."
        searchKeys={["performedByName", "targetId"]}
        csvFilename="finance-audit-logs"
        emptyTitle="No audit activity yet"
        emptyDescription="Finance actions (budgets, approvals, payments, receipts) will be logged here automatically."
        keyExtractor={(row) => row.id}
      />
    </div>
  );
}
