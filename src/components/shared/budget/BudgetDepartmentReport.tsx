"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { BudgetCategorySection } from "@/components/shared/budget/BudgetCategorySection";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  budgetRequestTotal,
  NON_RECURRING_CATEGORIES,
  RECURRING_CATEGORIES,
  type BudgetRequest,
} from "@/types";

const REPORT_FILTERS = ["ALL", "EXCLUDE_REJECTED", "FINANCE_APPROVED"] as const;
type ReportFilter = (typeof REPORT_FILTERS)[number];

const FILTER_LABELS: Record<ReportFilter, string> = {
  ALL: "All Statuses",
  EXCLUDE_REJECTED: "Exclude Rejected",
  FINANCE_APPROVED: "Finance Approved Only",
};

function matchesFilter(status: BudgetRequest["status"], filter: ReportFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "FINANCE_APPROVED") return status === "FINANCE_APPROVED";
  return status !== "PRINCIPAL_REJECTED" && status !== "FINANCE_REJECTED";
}

interface RequestCardProps {
  request: BudgetRequest;
}

function RequestCard({ request }: RequestCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 p-3 text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{request.title}</span>
            <StatusBadge status={request.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {request.academicYear} · Requested by {request.hodName} · Submitted {formatDate(request.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-semibold">{formatCurrency(budgetRequestTotal(request))}</span>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="p-3 pt-0 space-y-4 border-t">
          <BudgetCategorySection label="Non Recurring" categories={NON_RECURRING_CATEGORIES} groups={request.nonRecurring} readOnly />
          <BudgetCategorySection label="Recurring" categories={RECURRING_CATEGORIES} groups={request.recurring} readOnly />
        </div>
      )}
    </div>
  );
}

interface BudgetDepartmentReportProps {
  requests: BudgetRequest[];
  isLoading: boolean;
}

export function BudgetDepartmentReport({ requests, isLoading }: BudgetDepartmentReportProps) {
  const [filter, setFilter] = useState<ReportFilter>("ALL");

  const departments = useMemo(() => {
    const filtered = requests.filter((r) => matchesFilter(r.status, filter));
    const byDept = new Map<string, BudgetRequest[]>();
    for (const req of filtered) {
      const list = byDept.get(req.department) ?? [];
      list.push(req);
      byDept.set(req.department, list);
    }
    // requests already arrive ordered by createdAt desc from the API
    return Array.from(byDept.entries())
      .map(([department, reqs]) => ({
        department,
        requests: reqs,
        total: reqs.reduce((sum, r) => sum + budgetRequestTotal(r), 0),
      }))
      .sort((a, b) => a.department.localeCompare(b.department));
  }, [requests, filter]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Select value={filter} onValueChange={(v) => setFilter(v as ReportFilter)}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REPORT_FILTERS.map((f) => (
              <SelectItem key={f} value={f}>{FILTER_LABELS[f]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : departments.length === 0 ? (
        <EmptyState
          title="No budget requests found"
          description="Requests submitted by HODs will appear here, grouped by department."
          icon={<Building2 className="h-8 w-8" />}
        />
      ) : (
        departments.map(({ department, requests: deptRequests, total }) => (
          <Card key={department}>
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold text-sm">{department}</span>
                <span className="text-xs text-muted-foreground">({deptRequests.length} request{deptRequests.length === 1 ? "" : "s"})</span>
              </div>
              <span className="text-sm font-semibold">{formatCurrency(total)}</span>
            </CardHeader>
            <CardContent className="space-y-3">
              {deptRequests.map((request) => (
                <RequestCard key={request.id} request={request} />
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
