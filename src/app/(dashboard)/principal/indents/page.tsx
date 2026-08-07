"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ClipboardList, Clock, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { IndentStatusBadge } from "@/components/shared/indent/IndentStatusBadge";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { indentItemsTotal, INDENT_REQUEST_TYPE_LABELS, type IndentRequest } from "@/types";

export default function PrincipalIndentsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<IndentRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function load() {
    setIsLoading(true);
    fetch("/api/college/indent-requests")
      .then((r) => r.json() as Promise<{ requests: IndentRequest[] }>)
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load indent requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const terminal = new Set(["REJECTED_BY_PURCHASE", "REJECTED"]);
    return {
      pending: requests.filter((r) => !terminal.has(r.status) && r.status !== "APPROVED" && r.status !== "COMPLETED").length,
      approved: requests.filter((r) => r.status === "APPROVED").length,
      completed: requests.filter((r) => r.status === "COMPLETED").length,
      rejected: requests.filter((r) => terminal.has(r.status)).length,
    };
  }, [requests]);

  const stats = [
    { label: "Pending", value: counts.pending, icon: Clock, color: "text-amber-600 bg-amber-50" },
    { label: "Approved", value: counts.approved, icon: ClipboardList, color: "text-teal-600 bg-teal-50" },
    { label: "Completed", value: counts.completed, icon: CheckCircle2, color: "text-green-600 bg-green-50" },
    { label: "Rejected", value: counts.rejected, icon: XCircle, color: "text-red-600 bg-red-50" },
  ];

  const columns: Column<IndentRequest & Record<string, unknown>>[] = [
    { key: "title", header: "Title" },
    { key: "department", header: "Department", hideOnMobile: true },
    {
      key: "requestType",
      header: "Type",
      hideOnMobile: true,
      render: (row) => row.requestType ? <Badge variant="outline" className="text-xs">{INDENT_REQUEST_TYPE_LABELS[row.requestType]}</Badge> : null,
    },
    { key: "amount", header: "Est. Amount", render: (row) => formatCurrency(indentItemsTotal(row.items)) },
    { key: "createdAt", header: "Submitted", hideOnMobile: true, render: (row) => formatDate(row.createdAt) },
    { key: "status", header: "Status", render: (row) => <IndentStatusBadge status={row.status} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget History"
        description="Past indent requests raised by departments"
        actions={
          <Button variant="outline" size="sm" onClick={load} loading={isLoading}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${stat.color}`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-xl font-bold">{stat.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            data={requests as (IndentRequest & Record<string, unknown>)[]}
            columns={columns}
            isLoading={isLoading}
            searchPlaceholder="Search by title..."
            searchKeys={["title", "department"]}
            emptyTitle="No indent requests yet"
            emptyDescription="Indent requests raised by department HODs will appear here."
            keyExtractor={(row) => row.id}
            onRowClick={(row) => router.push(`/principal/indents/${row.id}`)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
