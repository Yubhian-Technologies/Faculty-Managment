"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IndentStatusBadge } from "@/components/shared/indent/IndentStatusBadge";
import { IndentHistoryTimeline } from "@/components/shared/indent/IndentHistoryTimeline";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { indentItemsTotal, INDENT_STATUS_LABELS, type IndentRequest, type IndentStatus } from "@/types";

export default function PrincipalIndentsPage() {
  const [requests, setRequests] = useState<IndentRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  useEffect(() => {
    setIsLoading(true);
    fetch("/api/college/indent-requests")
      .then((r) => r.json() as Promise<{ requests: IndentRequest[] }>)
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load indent requests" }))
      .finally(() => setIsLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q) ||
        r.hodName.toLowerCase().includes(q)
      );
    });
  }, [requests, search, statusFilter]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="View"
        description="Complete view of every indent request in your college — every step from submission through completion"
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Search by title, department, or HOD..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:max-w-xs">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {(Object.keys(INDENT_STATUS_LABELS) as IndentStatus[]).map((status) => (
              <SelectItem key={status} value={status}>{INDENT_STATUS_LABELS[status]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <EmptyState
          title="No indent requests"
          description="Indent requests raised by HODs in your college will appear here, with their full step-by-step history."
          icon={<ClipboardList className="h-8 w-8" />}
        />
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="space-y-4">
          {filtered.map((r) => (
            <Card key={r.id}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
                  <span>{r.title}</span>
                  <IndentStatusBadge status={r.status} />
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {r.department} · Raised by {r.hodName} on {formatDate(r.createdAt)}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="font-medium">{formatCurrency(indentItemsTotal(r.items))}</span>
                  <span className="text-muted-foreground">{r.category}</span>
                  <span className="text-muted-foreground">{r.requestType === "NON_GOODS" ? "Non-Goods" : "Goods"}</span>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Steps</p>
                  <IndentHistoryTimeline history={r.history} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
