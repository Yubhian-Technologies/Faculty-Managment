"use client";

import { Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { IndentStatusBadge } from "@/components/shared/indent/IndentStatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { indentItemsTotal, type IndentRequest } from "@/types";

interface IndentRequestsTableProps {
  requests: IndentRequest[];
  isLoading: boolean;
  onEditRequest: (request: IndentRequest) => void;
  onViewRequest: (request: IndentRequest) => void;
}

export function IndentRequestsTable({ requests, isLoading, onEditRequest, onViewRequest }: IndentRequestsTableProps) {
  const columns: Column<IndentRequest & Record<string, unknown>>[] = [
    { key: "title", header: "Title" },
    { key: "department", header: "Department", hideOnMobile: true },
    { key: "amount", header: "Est. Amount", render: (row) => formatCurrency(indentItemsTotal(row.items)) },
    { key: "createdAt", header: "Submitted", hideOnMobile: true, render: (row) => formatDate(row.createdAt) },
    { key: "status", header: "Status", render: (row) => <IndentStatusBadge status={row.status} /> },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row) =>
        row.status === "RETURNED_TO_HOD" ? (
          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onEditRequest(row); }}>
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Edit & Resubmit
          </Button>
        ) : null,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">My Indent Requests</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          data={requests as (IndentRequest & Record<string, unknown>)[]}
          columns={columns}
          isLoading={isLoading}
          searchPlaceholder="Search by title..."
          searchKeys={["title"]}
          emptyTitle="No indent requests yet."
          emptyDescription="Indents you raise will appear here with their approval status."
          keyExtractor={(row) => row.id}
          onRowClick={onViewRequest}
        />
      </CardContent>
    </Card>
  );
}
