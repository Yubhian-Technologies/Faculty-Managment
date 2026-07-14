"use client";

import { Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { budgetRequestTotal, type BudgetRequest } from "@/types";

interface BudgetRequestsTableProps {
  requests: BudgetRequest[];
  isLoading: boolean;
  onEditRequest: (request: BudgetRequest) => void;
  onViewRequest: (request: BudgetRequest) => void;
}

export function BudgetRequestsTable({ requests, isLoading, onEditRequest, onViewRequest }: BudgetRequestsTableProps) {
  const columns: Column<BudgetRequest & Record<string, unknown>>[] = [
    { key: "title", header: "Title" },
    { key: "academicYear", header: "Academic Year", hideOnMobile: true },
    { key: "amount", header: "Amount", render: (row) => formatCurrency(budgetRequestTotal(row)) },
    { key: "createdAt", header: "Submitted", hideOnMobile: true, render: (row) => formatDate(row.createdAt) },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) =>
        row.status === "RETURNED_TO_HOD" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => { e.stopPropagation(); onEditRequest(row); }}
          >
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Edit & Resubmit
          </Button>
        ) : null,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">My Budget Requests</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          data={requests as (BudgetRequest & Record<string, unknown>)[]}
          columns={columns}
          isLoading={isLoading}
          searchPlaceholder="Search by title, academic year..."
          searchKeys={["title", "academicYear"]}
          emptyTitle="No budget requests yet."
          emptyDescription="Requests you submit will appear here with their approval status."
          keyExtractor={(row) => row.id}
          onRowClick={onViewRequest}
        />
      </CardContent>
    </Card>
  );
}
