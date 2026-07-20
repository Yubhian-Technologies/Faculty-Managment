"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatCurrency } from "@/lib/utils";
import type { FinanceBudget, FinanceFundAllocation } from "@/types";

type Row = FinanceFundAllocation & Record<string, unknown>;

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800 border-green-200",
  MODIFIED: "bg-orange-100 text-orange-800 border-orange-200",
  EXHAUSTED: "bg-red-100 text-red-800 border-red-200",
  CLOSED: "bg-gray-100 text-gray-800 border-gray-200",
};

export default function FinanceFundAllocationPage() {
  const router = useRouter();
  const [allocations, setAllocations] = useState<Row[]>([]);
  const [budgets, setBudgets] = useState<FinanceBudget[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function load() {
    setIsLoading(true);
    Promise.all([
      collegeFetch("/api/college/finance-fund-allocations").then((r) => r.json() as Promise<{ allocations: Row[] }>).then((d) => d.allocations ?? []),
      collegeFetch("/api/college/finance-budgets?status=ACTIVE").then((r) => r.json() as Promise<{ budgets: FinanceBudget[] }>).then((d) => d.budgets ?? []),
    ]).then(([a, b]) => { setAllocations(a); setBudgets(b); })
      .catch(() => toast({ variant: "destructive", title: "Failed to load allocations" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  const columns: Column<Row>[] = [
    { key: "targetName", header: "Allocated To" },
    { key: "targetType", header: "Type", render: (row) => <Badge variant="secondary">{row.targetType}</Badge> },
    { key: "amount", header: "Amount", render: (row) => formatCurrency(row.amount) },
    { key: "remainingAmount", header: "Remaining", render: (row) => formatCurrency(row.remainingAmount) },
    { key: "status", header: "Status", render: (row) => <Badge variant="outline" className={STATUS_COLOR[row.status]}>{row.status}</Badge> },
    {
      key: "actions", header: "", className: "text-right",
      render: (row) => (
        <Button size="sm" variant="outline" onClick={() => router.push(`/finance/fund-allocation/${row.id}/edit`)}>Modify</Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fund Allocation"
        description="Allocate approved budgets to departments, projects, events, and purchases"
        actions={
          <Button onClick={() => router.push("/finance/fund-allocation/new")} disabled={budgets.length === 0}>
            <Plus className="h-4 w-4 mr-1" />
            Allocate Funds
          </Button>
        }
      />

      <DataTable
        data={allocations}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Search by target name..."
        searchKeys={["targetName"]}
        csvFilename="finance-fund-allocations"
        emptyTitle="No allocations yet"
        emptyDescription="Allocate funds from an active budget to a department, project, event, or purchase."
        keyExtractor={(row) => row.id}
      />
    </div>
  );
}
