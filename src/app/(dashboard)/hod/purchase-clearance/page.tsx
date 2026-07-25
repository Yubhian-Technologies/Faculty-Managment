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
import {
  INDENT_STATUS_LABELS,
  PURCHASE_CLEARANCE_STATUS_LABELS,
  indentItemsTotal,
  type FinancePurchaseClearance,
  type IndentRequest,
} from "@/types";

// Contacting Purchase Dept happens two ways: a freeform clearance request, or
// a GOODS-type indent (NON_GOODS indents skip Purchase Dept entirely — see
// IndentRequestType in src/types/indent.ts) — both are shown here together.
type Row = Record<string, unknown> &
  (
    // sourceRequestId set = auto-created when Finance approved the linked budget
    // request (see budget-requests/[id]/route.ts) — title/amount are copied
    // from that budget, so it needs its own label to avoid looking like a
    // second, duplicate budget request.
    | { kind: "CLEARANCE"; id: string; title: string; amount: number; status: string; createdAt: unknown; href: string; sourceRequestId?: string }
    | { kind: "INDENT"; id: string; title: string; amount: number; status: string; createdAt: unknown; href: string }
  );

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

export default function HODPurchaseClearancePage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function load() {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/finance-purchase-clearance").then((r) => r.json() as Promise<{ requests: FinancePurchaseClearance[] }>).then((d) => d.requests ?? []),
      fetch("/api/college/indent-requests").then((r) => r.json() as Promise<{ requests: IndentRequest[] }>).then((d) => d.requests ?? []),
    ])
      .then(([clearances, indents]) => {
        const clearanceRows: Row[] = clearances.map((r) => ({
          kind: "CLEARANCE", id: r.id, title: r.items, amount: r.estimatedAmount,
          status: r.status, createdAt: r.createdAt, href: `/hod/purchase-clearance/${r.id}`,
          sourceRequestId: r.sourceRequestId,
        }));
        const indentRows: Row[] = indents
          .filter((r) => r.requestType === "GOODS")
          .map((r) => ({
            kind: "INDENT", id: r.id, title: r.title, amount: indentItemsTotal(r.items),
            status: r.status, createdAt: r.createdAt, href: `/hod/indents/${r.id}`,
          }));
        setRows([...clearanceRows, ...indentRows].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load purchase clearance requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  const columns: Column<Row>[] = [
    { key: "title", header: "Items" },
    {
      key: "kind", header: "Type",
      render: (row) => (
        <Badge variant="outline" className="text-xs">
          {row.kind === "INDENT" ? "Indent" : row.sourceRequestId ? "From Budget" : "Clearance"}
        </Badge>
      ),
    },
    { key: "amount", header: "Estimated Amount", render: (row) => formatCurrency(row.amount) },
    {
      key: "status", header: "Status",
      render: (row) => (
        <Badge variant="outline" className={STATUS_COLOR[row.status]}>
          {row.kind === "INDENT"
            ? INDENT_STATUS_LABELS[row.status as keyof typeof INDENT_STATUS_LABELS] ?? row.status
            : PURCHASE_CLEARANCE_STATUS_LABELS[row.status as keyof typeof PURCHASE_CLEARANCE_STATUS_LABELS] ?? row.status}
        </Badge>
      ),
    },
    { key: "createdAt", header: "Raised On", hideOnMobile: true, render: (row) => formatDate(row.createdAt as Parameters<typeof formatDate>[0]) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase Clearance"
        description="Goods indents and purchase clearance requests you've raised with Purchase Dept"
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
        data={rows}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Search by items..."
        searchKeys={["title"]}
        emptyTitle="No purchase clearance requests"
        emptyDescription="Requests you raise will appear here."
        keyExtractor={(row) => `${row.kind}-${row.id}`}
        onRowClick={(row) => router.push(row.href)}
      />
    </div>
  );
}
