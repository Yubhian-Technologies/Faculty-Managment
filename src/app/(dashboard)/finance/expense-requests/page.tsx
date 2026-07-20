"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ClipboardList, Building2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ApprovalWorkflowList } from "@/components/finance/ApprovalWorkflowList";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { FinanceBudget, FinanceExpenseRequest } from "@/types";

type Row = FinanceExpenseRequest & { id: string; status: string };

export default function FinanceExpenseRequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<Row[]>([]);
  const [budgets, setBudgets] = useState<FinanceBudget[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function load() {
    setIsLoading(true);
    Promise.all([
      collegeFetch("/api/college/finance-expense-requests").then((r) => r.json() as Promise<{ requests: Row[] }>).then((d) => d.requests ?? []),
      collegeFetch("/api/college/finance-budgets?status=ACTIVE").then((r) => r.json() as Promise<{ budgets: FinanceBudget[] }>).then((d) => d.budgets ?? []),
    ]).then(([r, b]) => { setRequests(r); setBudgets(b); })
      .catch(() => toast({ variant: "destructive", title: "Failed to load expense requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  const budgetName = (id: string) => budgets.find((b) => b.id === id)?.department ?? id;
  const pending = requests.filter((r) => r.status === "PENDING");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expense Requests"
        description="Review expenditure requests against available budget"
        actions={
          <Button onClick={() => router.push("/finance/expense-requests/new")} disabled={budgets.length === 0}>
            <Plus className="h-4 w-4 mr-1" />
            Log Request
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Pending Requests</p>
          <p className="text-2xl font-bold text-yellow-600">{isLoading ? "…" : pending.length}</p>
        </CardContent>
      </Card>

      <ApprovalWorkflowList
        items={requests}
        isLoading={isLoading}
        patchUrl={(item) => `/api/college/finance-expense-requests/${item.id}`}
        onChanged={load}
        emptyTitle="No expense requests"
        emptyDescription="Log an expenditure request received from a department to start the approval workflow."
        icon={<ClipboardList className="h-8 w-8" />}
        renderSummary={(item) => (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-semibold text-sm">{item.department}</span>
              <Badge variant="secondary" className="text-xs">{formatCurrency(item.amount)}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{item.purpose} · Budget: {budgetName(item.budgetId)}</p>
          </div>
        )}
        renderDetails={(item) => (
          <div className="text-sm space-y-2 pt-1">
            {item.justification && (
              <div>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Justification</span>
                <p className="mt-1 rounded bg-muted/40 p-2">{item.justification}</p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Logged by {item.loggedByName} on {formatDate(item.createdAt)}</p>
            {item.financeRemarks && (
              <div>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Finance Remarks</span>
                <p className="mt-1 rounded bg-muted/40 p-2">{item.financeRemarks}</p>
              </div>
            )}
          </div>
        )}
      />
    </div>
  );
}
