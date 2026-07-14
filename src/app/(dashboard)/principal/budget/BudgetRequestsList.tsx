"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { budgetRequestTotal, type BudgetRequest, type BudgetRequestStatus } from "@/types";

const STATUS_OPTIONS: readonly (BudgetRequestStatus | "All")[] = [
  "All",
  "PENDING_PRINCIPAL_VERIFICATION",
  "RETURNED_TO_HOD",
  "L1_FROZEN",
  "PRINCIPAL_REJECTED",
  "FINANCE_APPROVED",
  "FINANCE_REJECTED",
];

interface BudgetRequestsListProps {
  requests: BudgetRequest[];
  isLoading: boolean;
  onSelectRequest: (request: BudgetRequest) => void;
}

export function BudgetRequestsList({ requests, isLoading, onSelectRequest }: BudgetRequestsListProps) {
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [departmentFilter, setDepartmentFilter] = useState<string>("All");

  const departments = useMemo(
    () => Array.from(new Set(requests.map((r) => r.department).filter(Boolean))).sort(),
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
          isLoading={isLoading}
          keyExtractor={(row) => row.id as string}
          searchPlaceholder="Search by department, title..."
          searchKeys={["department", "hodName", "title"]}
          emptyTitle="No budget requests found"
          emptyDescription="Try adjusting your search or filters."
          onRowClick={(row) => onSelectRequest(row as unknown as BudgetRequest)}
          filterComponent={
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-44">
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
            { key: "department", header: "Department" },
            { key: "hodName", header: "Requested By", hideOnMobile: true },
            { key: "academicYear", header: "Academic Year", hideOnMobile: true },
            { key: "title", header: "Title" },
            {
              key: "amount",
              header: "Amount",
              render: (row) => formatCurrency(budgetRequestTotal(row as unknown as BudgetRequest)),
            },
            {
              key: "createdAt",
              header: "Submitted",
              hideOnMobile: true,
              render: (row) => formatDate((row as unknown as BudgetRequest).createdAt),
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
