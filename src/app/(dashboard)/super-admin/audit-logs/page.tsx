"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { toast } from "@/hooks/useToast";
import { formatDateTime } from "@/lib/utils";
import type { AuditLog, College } from "@/types";

type LogRow = Record<string, unknown> & AuditLog;

export default function AuditLogsPage() {
  const [colleges, setColleges] = useState<College[]>([]);
  const [selectedCollegeId, setSelectedCollegeId] = useState("");
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetch("/api/admin/colleges")
      .then((r) => r.json() as Promise<{ colleges: College[] }>)
      .then((data) => {
        const c = data.colleges ?? [];
        setColleges(c);
        if (c.length > 0) setSelectedCollegeId(c[0].id);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load colleges" }));
  }, []);

  useEffect(() => {
    if (!selectedCollegeId) return;
    setIsLoading(true);

    fetch(`/api/admin/audit-logs?collegeId=${encodeURIComponent(selectedCollegeId)}`)
      .then((r) => r.json() as Promise<{ logs: LogRow[] }>)
      .then((data) => setLogs(data.logs ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load audit logs" }))
      .finally(() => setIsLoading(false));
  }, [selectedCollegeId]);

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
          {row.details ? JSON.stringify(row.details).slice(0, 80) : "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Logs"
        description="System-wide action trail — last 100 events per college"
      />

      {colleges.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-muted-foreground font-medium">College:</span>
          <div className="flex gap-2 flex-wrap">
            {colleges.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCollegeId(c.id)}
                className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                  selectedCollegeId === c.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

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
