"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { BudgetCycleApprovalCard } from "./BudgetCycleApprovalCard";
import { BudgetSummaryCards } from "./BudgetSummaryCards";
import { BudgetRequestsList } from "./BudgetRequestsList";
import { toast } from "@/hooks/useToast";
import type { BudgetCycle, BudgetRequest } from "@/types";

export default function PrincipalBudgetPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<BudgetRequest[]>([]);
  const [pendingCycle, setPendingCycle] = useState<BudgetCycle | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  function load() {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/budget-requests").then((r) => r.json() as Promise<{ requests: BudgetRequest[] }>),
      fetch("/api/college/budget-cycles?status=PENDING_APPROVAL").then((r) => r.json() as Promise<{ cycles: BudgetCycle[] }>),
    ])
      .then(([reqData, cycleData]) => {
        setRequests(reqData.requests ?? []);
        setPendingCycle(cycleData.cycles?.[0] ?? null);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load budget data" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function actOnCycle(action: "APPROVE" | "REJECT" | "RETURN", remarks?: string) {
    if (!pendingCycle) return;
    const res = await fetch(`/api/college/budget-cycles/${pendingCycle.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, remarks }),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      toast({ variant: "destructive", title: "Failed to act on budget cycle", description: err.error });
      return;
    }
    toast({ variant: "success", title: `Budget cycle ${action === "APPROVE" ? "approved" : action === "REJECT" ? "rejected" : "returned"}` });
    load();
  }

  const terminal = new Set(["PRINCIPAL_REJECTED", "FINANCE_REJECTED", "MANAGEMENT_REJECTED"]);
  const approved = new Set(["L1_FROZEN", "FINANCE_APPROVED"]);
  const counts = {
    total: requests.length,
    pending: requests.filter((r) => !terminal.has(r.status) && !approved.has(r.status)).length,
    approved: requests.filter((r) => approved.has(r.status)).length,
    rejected: requests.filter((r) => terminal.has(r.status)).length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget"
        description="Departmental budget requests, approvals, and fund tracking"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} loading={isLoading}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            <Button onClick={() => router.push("/principal/budget/new")}>Raise Emergency Request</Button>
          </div>
        }
      />

      {pendingCycle && <BudgetCycleApprovalCard cycle={pendingCycle} onAct={actOnCycle} />}

      <BudgetSummaryCards {...counts} />

      <BudgetRequestsList
        requests={requests}
        isLoading={isLoading}
        onSelectRequest={(r) => router.push(`/principal/budget/${r.id}`)}
      />
    </div>
  );
}
