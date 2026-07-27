"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PURCHASE_CLEARANCE_STATUS_LABELS, type FinancePurchaseClearance } from "@/types";

// Emergency (GOODS) budget requests auto-create a financePurchaseClearance
// doc once Finance approves them (see budget-requests/[id]/route.ts) — unlike
// the HOD version of this page, a Principal/VP never raises one manually, so
// there's no "Raise Request" action and no indent join here.
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

function toMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return value ? new Date(value as string).getTime() : 0;
}

type Row = FinancePurchaseClearance & Record<string, unknown>;

export default function PrincipalPurchaseClearancePage() {
  const router = useRouter();
  const [requests, setRequests] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function load() {
    setIsLoading(true);
    fetch("/api/college/finance-purchase-clearance")
      .then((r) => r.json() as Promise<{ requests: Row[] }>)
      .then((d) => setRequests((d.requests ?? []).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))))
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
          {PURCHASE_CLEARANCE_STATUS_LABELS[row.status] ?? row.status}
        </Badge>
      ),
    },
    { key: "createdAt", header: "Raised On", hideOnMobile: true, render: (row) => formatDate(row.createdAt) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase Clearance"
        description="Emergency purchase requests you've raised, now with Purchase Dept / Finance"
        actions={
          <Button variant="outline" size="sm" onClick={load} loading={isLoading}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        }
      />

      <DataTable
        data={requests}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Search by items..."
        searchKeys={["items"]}
        emptyTitle="No purchase clearance requests"
        emptyDescription="Requests auto-created from your approved emergency budget requests will appear here."
        keyExtractor={(row) => row.id}
        onRowClick={(row) => router.push(`/principal/purchase-clearance/${row.id}`)}
      />
    </div>
  );
}
