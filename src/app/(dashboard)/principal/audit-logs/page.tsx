"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { formatDateTime, toDate } from "@/lib/utils";
import type { AuditLog } from "@/types";

type LogRow = Record<string, unknown> & AuditLog;

export default function CollegeAuditLogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fromDate, setFromDate] = useState("");
  const [toDateStr, setToDateStr] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    fetch("/api/college/audit-logs")
      .then((r) => r.json() as Promise<{ logs: LogRow[] }>)
      .then((data) => setLogs(data.logs ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load audit logs" }))
      .finally(() => setIsLoading(false));
  }, []);

  const filteredLogs = useMemo(() => {
    if (!fromDate && !toDateStr) return logs;
    return logs.filter((row) => {
      const d = toDate(row.timestamp as Parameters<typeof toDate>[0]);
      if (!d) return false;
      const day = d.toISOString().split("T")[0];
      if (fromDate && day < fromDate) return false;
      if (toDateStr && day > toDateStr) return false;
      return true;
    });
  }, [logs, fromDate, toDateStr]);

  const csvFilename = useMemo(() => {
    if (fromDate && toDateStr) return `audit-logs-${fromDate}_to_${toDateStr}`;
    if (fromDate) return `audit-logs-from-${fromDate}`;
    if (toDateStr) return `audit-logs-to-${toDateStr}`;
    return "audit-logs";
  }, [fromDate, toDateStr]);

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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4 rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-from" className="text-xs">From</Label>
          <Input id="audit-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[160px]" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-to" className="text-xs">To</Label>
          <Input id="audit-to" type="date" value={toDateStr} onChange={(e) => setToDateStr(e.target.value)} className="w-[160px]" />
        </div>
        <div className="flex items-center gap-2 sm:ml-2">
          <Button variant="default" size="sm" disabled={!fromDate && !toDateStr}>Apply</Button>
          <Button variant="outline" size="sm" onClick={() => { setFromDate(""); setToDateStr(""); }} disabled={!fromDate && !toDateStr}>Clear</Button>
        </div>
        {(fromDate || toDateStr) && (
          <span className="text-xs text-muted-foreground sm:ml-auto">Showing {filteredLogs.length} of {logs.length} logs</span>
        )}
      </div>

      <DataTable
        data={filteredLogs}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        searchPlaceholder="Search actions..."
        searchKeys={["action", "performedByName"] as (keyof LogRow)[]}
        emptyTitle="No audit logs yet"
        emptyDescription="Actions will appear here as staff use the system"
        csvFilename={csvFilename}
      />
    </div>
  );
}
