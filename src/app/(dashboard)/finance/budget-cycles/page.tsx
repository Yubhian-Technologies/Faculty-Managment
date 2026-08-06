"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatDate } from "@/lib/utils";
import {
  BUDGET_CYCLE_STATUS_LABELS, BUDGET_TYPE_LABELS, BUDGET_REQUEST_STATUS_LABELS,
  type BudgetCycle, type BudgetCycleStatus, type BudgetRequest,
} from "@/types";

type CycleRow = BudgetCycle & Record<string, unknown>;

const CYCLE_STATUS_COLOR: Record<BudgetCycleStatus, string> = {
  PENDING_APPROVAL: "bg-amber-100 text-amber-800 border-amber-200",
  APPROVED: "bg-green-100 text-green-800 border-green-200",
  REJECTED: "bg-red-100 text-red-800 border-red-200",
  RETURNED: "bg-orange-100 text-orange-800 border-orange-200",
};

const REQUEST_STATUS_COLOR: Record<string, string> = {
  PENDING_SUBMISSION: "bg-amber-100 text-amber-800 border-amber-200",
  FINANCE_APPROVED: "bg-green-100 text-green-800 border-green-200",
  PRINCIPAL_REJECTED: "bg-red-100 text-red-800 border-red-200",
  FINANCE_REJECTED: "bg-red-100 text-red-800 border-red-200",
};

export default function FinanceBudgetCyclesPage() {
  const router = useRouter();
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<CycleRow | null>(null);
  const [deptRequests, setDeptRequests] = useState<BudgetRequest[]>([]);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  function load() {
    setIsLoading(true);
    collegeFetch("/api/college/budget-cycles")
      .then((r) => r.json() as Promise<{ cycles: CycleRow[] }>)
      .then((d) => setCycles(d.cycles ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load budget cycles" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  function openDetail(cycle: CycleRow) {
    setSelected(cycle);
    setIsLoadingDetail(true);
    collegeFetch(`/api/college/budget-requests?budgetCycleId=${cycle.id}`)
      .then((r) => r.json() as Promise<{ requests: BudgetRequest[] }>)
      .then((d) => setDeptRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load department budgets" }))
      .finally(() => setIsLoadingDetail(false));
  }

  const columns: Column<CycleRow>[] = [
    { key: "title", header: "Title" },
    { key: "financialYear", header: "Financial Year" },
    { key: "budgetType", header: "Type", render: (c) => BUDGET_TYPE_LABELS[c.budgetType] },
    {
      key: "status", header: "Status",
      render: (c) => <Badge variant="outline" className={CYCLE_STATUS_COLOR[c.status]}>{BUDGET_CYCLE_STATUS_LABELS[c.status]}</Badge>,
    },
    { key: "submissionDeadline", header: "Deadline", render: (c) => formatDate(new Date(c.submissionDeadline)) },
    { key: "createdByName", header: "Released By", hideOnMobile: true },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget Cycles"
        description="Institution-wide budget releases and their Principal approval status"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} loading={isLoading}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            <Button onClick={() => router.push("/finance/budget/new")}>
              <Plus className="h-4 w-4 mr-1" />
              Release Budget Cycle
            </Button>
          </>
        }
      />

      <DataTable
        data={cycles}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Search by title..."
        searchKeys={["title", "financialYear"]}
        csvFilename="budget-cycles"
        emptyTitle="No budget cycles yet"
        emptyDescription="Release a budget cycle to start collecting department budgets."
        keyExtractor={(c) => c.id}
        onRowClick={openDetail}
      />

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{selected?.title} - Department Status</DialogTitle></DialogHeader>
          {isLoadingDetail ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : deptRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {selected?.status === "PENDING_APPROVAL" ? "Not yet approved - departments haven't been notified." : "No departments found."}
            </p>
          ) : (
            <div className="divide-y">
              {deptRequests.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="text-sm font-medium">{r.department}</p>
                    <p className="text-xs text-muted-foreground">{r.hodName}</p>
                  </div>
                  <Badge variant="outline" className={REQUEST_STATUS_COLOR[r.status] ?? ""}>
                    {BUDGET_REQUEST_STATUS_LABELS[r.status]}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
