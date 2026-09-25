"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { formatDateTime, toDate } from "@/lib/utils";
import { istDateKey } from "@/lib/attendance/istTime";
import type { AuditLog, College } from "@/types";

type LogRow = Record<string, unknown> & AuditLog;

export default function AuditLogsPage() {
  const [colleges, setColleges] = useState<College[]>([]);
  const [selectedCollegeId, setSelectedCollegeId] = useState("");
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDateStr, setToDateStr] = useState("");

  // Batch 2: AbortController for audit-logs fetch — aborts previous before new
  const logsAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { logsAbortRef.current?.abort(); }, []);

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

  // Reset loaded state when college changes - require explicit Load again
  useEffect(() => {
    setLogs([]);
    setHasLoaded(false);
  }, [selectedCollegeId]);

  function handleLoad() {
    if (!selectedCollegeId) {
      toast({ variant: "destructive", title: "Select a college first" });
      return;
    }
    if (fromDate && toDateStr) {
      const from = new Date(fromDate);
      const to = new Date(toDateStr);
      const fromValid = !isNaN(from.getTime());
      const toValid = !isNaN(to.getTime());
      if (fromValid && toValid && from > to) {
        toast({ variant: "destructive", title: "Invalid date range", description: "From date cannot be after To date." });
        return;
      }
      // Fallback string compare if either date is unparsable (should not happen for <input type="date">)
      if (!fromValid || !toValid) {
        if (fromDate > toDateStr) {
          toast({ variant: "destructive", title: "Invalid date range", description: "From date cannot be after To date." });
          return;
        }
      }
    }
    logsAbortRef.current?.abort();
    const ctrl = new AbortController();
    logsAbortRef.current = ctrl;
    setIsLoading(true);
    setHasLoaded(true);
    // Forward from/to to server as optional params — additive; server prunes if index exists,
    // client filteredLogs remains fallback so behavior is unchanged.
    const params = new URLSearchParams({ collegeId: selectedCollegeId });
    if (fromDate) params.set("from", fromDate);
    if (toDateStr) params.set("to", toDateStr);
    fetch(`/api/admin/audit-logs?${params.toString()}`, { signal: ctrl.signal })
      .then((r) => r.json() as Promise<{ logs: LogRow[] }>)
      .then((data) => setLogs(data.logs ?? []))
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        toast({ variant: "destructive", title: "Failed to load audit logs" });
      })
      .finally(() => setIsLoading(false));
  }

  const filteredLogs = useMemo(() => {
    if (!fromDate && !toDateStr) return logs;
    return logs.filter((row) => {
      const d = toDate(row.timestamp as Parameters<typeof toDate>[0]);
      if (!d) return false;
      const day = istDateKey(d);
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
      csvValue: (row) => formatDateTime(row.timestamp as Parameters<typeof formatDateTime>[0]),
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
      csvValue: (row) => (row.details ? JSON.stringify(row.details) : ""),
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
        description="System-wide action trail - last 100 events per college"
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
          <Button variant="default" size="sm" onClick={handleLoad} loading={isLoading} disabled={!selectedCollegeId}>Load</Button>
          <Button variant="outline" size="sm" onClick={() => { setFromDate(""); setToDateStr(""); }} disabled={!fromDate && !toDateStr}>Clear</Button>
        </div>
        {hasLoaded ? (
          <span className="text-xs text-muted-foreground sm:ml-auto">Showing {filteredLogs.length} of {logs.length} logs</span>
        ) : (
          <span className="text-xs text-muted-foreground sm:ml-auto">Select dates (optional) and click Load</span>
        )}
      </div>

      {!hasLoaded ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Select a college, optionally pick From/To dates, then click <span className="font-medium">Load</span> to view audit logs.
        </div>
      ) : (
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
      )}
    </div>
  );
}
