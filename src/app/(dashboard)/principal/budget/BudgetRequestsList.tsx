"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { requestAmount, type BudgetRequest } from "./mockBudgetRequests";

const STATUS_OPTIONS = ["All", "PENDING", "APPROVED", "REJECTED"] as const;

interface BudgetRequestsListProps {
  requests: BudgetRequest[];
  onSelectRequest: (request: BudgetRequest) => void;
}

export function BudgetRequestsList({ requests, onSelectRequest }: BudgetRequestsListProps) {
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [departmentFilter, setDepartmentFilter] = useState<string>("All");

  const departments = useMemo(
    () => Array.from(new Set(requests.map((r) => r.department))).sort(),
    [requests]
  );

  const filtered = requests.filter((r) => {
    if (statusFilter !== "All" && r.status !== statusFilter) return false;
    if (departmentFilter !== "All" && r.department !== departmentFilter) return false;
    return true;
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">All Budget Requests</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable<Record<string, unknown>>
          data={filtered as unknown as Record<string, unknown>[]}
          keyExtractor={(row) => row.id as string}
          searchPlaceholder="Search by request, department, title..."
          searchKeys={["id", "department", "requestedBy", "category", "title"]}
          emptyTitle="No budget requests found"
          emptyDescription="Try adjusting your search or filters."
          onRowClick={(row) => onSelectRequest(row as unknown as BudgetRequest)}
          filterComponent={
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{s === "All" ? "All Statuses" : s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Departments</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
          columns={[
            { key: "id", header: "Request ID" },
            { key: "department", header: "Department" },
            { key: "requestedBy", header: "Requested By", hideOnMobile: true },
            { key: "category", header: "Category", hideOnMobile: true },
            { key: "title", header: "Title" },
            {
              key: "amount",
              header: "Amount",
              render: (row) => formatCurrency(requestAmount(row as unknown as BudgetRequest)),
            },
            {
              key: "priority",
              header: "Priority",
              hideOnMobile: true,
              render: (row) => (row as unknown as BudgetRequest).priority,
            },
            {
              key: "submittedDate",
              header: "Submitted",
              hideOnMobile: true,
              render: (row) => formatDate(new Date((row as unknown as BudgetRequest).submittedDate)),
            },
            {
              key: "status",
              header: "Status",
              render: (row) => <StatusBadge status={(row as unknown as BudgetRequest).status} />,
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}
