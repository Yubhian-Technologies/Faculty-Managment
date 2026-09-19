"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { toast } from "@/hooks/useToast";
import { formatDateTime } from "@/lib/utils";
import type { AuditLog } from "@/types";

type LogRow = Record<string, unknown> & AuditLog;

export default function CollegeAuditLogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch("/api/college/audit-logs")
      .then((r) => r.json() as Promise<{ logs: LogRow[] }>)
      .then((data) => setLogs(data.logs ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load audit logs" }))
      .finally(() => setIsLoading(false));
  }, []);

  const columns: Column<LogRow>[] = [
    {
      key: "timestamp",
      header: "Time",
      render: (row) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDateTime(row.timestamp as Parameters<typeof formatDateTime>[0])}
        </span>
      ),
    },
    {
      key: "action",
      header: "Action",
      render: (row) => (
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
          {row.action as string}
        </code>
      ),
    },
    {
      key: "performedByName",
      header: "By",
      render: (row) => (
        <div>
          <p className="text-sm font-medium">{row.performedByName as string}</p>
          <p className="text-xs text-muted-foreground">{row.performedBy as string}</p>
        </div>
      ),
    },
    {
      key: "details",
      header: "Details",
      hideOnMobile: true,
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.details ? JSON.stringify(row.details).slice(0, 80) : "-"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Logs"
        description="This college's action trail - last 100 events"
      />

      <DataTable
        data={logs}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        searchPlaceholder="Search actions..."
        searchKeys={["action", "performedByName"] as (keyof LogRow)[]}
        emptyTitle="No audit logs yet"
        emptyDescription="Actions will appear here as staff use the system"
        csvFilename="audit-logs"
      />
    </div>
  );
}
