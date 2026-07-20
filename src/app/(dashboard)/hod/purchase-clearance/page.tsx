"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PURCHASE_CLEARANCE_STATUS_LABELS, type FinancePurchaseClearance } from "@/types";

type Row = FinancePurchaseClearance & Record<string, unknown>;

const STATUS_COLOR: Record<string, string> = {
  PENDING_PURCHASE_REVIEW: "bg-yellow-100 text-yellow-800 border-yellow-200",
  REJECTED_BY_PURCHASE: "bg-red-100 text-red-800 border-red-200",
  RETURNED_TO_HOD: "bg-orange-100 text-orange-800 border-orange-200",
  PENDING_FINANCE_REVIEW: "bg-yellow-100 text-yellow-800 border-yellow-200",
  RETURNED_TO_PURCHASE: "bg-orange-100 text-orange-800 border-orange-200",
  REJECTED: "bg-red-100 text-red-800 border-red-200",
  APPROVED: "bg-green-100 text-green-800 border-green-200",
  GOODS_PURCHASED: "bg-blue-100 text-blue-800 border-blue-200",
  COMPLETED: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export default function HODPurchaseClearancePage() {
  const router = useRouter();
  const [requests, setRequests] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function load() {
    setIsLoading(true);
    fetch("/api/college/finance-purchase-clearance")
      .then((r) => r.json() as Promise<{ requests: Row[] }>)
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load purchase clearance requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  const columns: Column<Row>[] = [
    { key: "items", header: "Items" },
    { key: "estimatedAmount", header: "Estimated Amount", render: (row) => formatCurrency(row.estimatedAmount) },
    {
      key: "status", header: "Status",
      render: (row) => (
        <Badge variant="outline" className={STATUS_COLOR[row.status]}>
          {PURCHASE_CLEARANCE_STATUS_LABELS[row.status as keyof typeof PURCHASE_CLEARANCE_STATUS_LABELS] ?? row.status}
        </Badge>
      ),
    },
    { key: "createdAt", header: "Raised On", hideOnMobile: true, render: (row) => formatDate(row.createdAt) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase Clearance"
        description="Raise purchase clearance requests and confirm goods received"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} loading={isLoading}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            <Button size="sm" onClick={() => router.push("/hod/purchase-clearance/new")}>
              <Plus className="h-4 w-4 mr-1" />
              Raise Request
            </Button>
          </>
        }
      />

      <DataTable
        data={requests}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Search by items..."
        searchKeys={["items"]}
        emptyTitle="No purchase clearance requests"
        emptyDescription="Requests you raise will appear here."
        keyExtractor={(row) => row.id}
        onRowClick={(row) => router.push(`/hod/purchase-clearance/${row.id}`)}
      />
    </div>
  );
}
