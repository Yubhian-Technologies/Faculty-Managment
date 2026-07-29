"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, AlertTriangle, Building2, Clock, CheckCircle2, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BudgetSummaryCards } from "./BudgetSummaryCards";
import { BudgetRequestsList } from "./BudgetRequestsList";
import { BudgetCycleApprovalCard } from "./BudgetCycleApprovalCard";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import type { BudgetCycle, BudgetRequest } from "@/types";

function CycleDeptStats({ requests }: { requests: BudgetRequest[] }) {
  const stats = useMemo(() => {
    const submitted = requests.filter((r) => r.status !== "PENDING_SUBMISSION").length;
    const pendingReview = requests.filter((r) => r.status === "PENDING_PRINCIPAL_VERIFICATION").length;
    const approved = requests.filter((r) => r.status === "L1_FROZEN" || r.status === "FINANCE_APPROVED").length;
    const returned = requests.filter((r) => r.status === "RETURNED_TO_HOD").length;
    return [
      { label: "Departments Submitted", value: submitted, icon: Building2, color: "text-blue-600 bg-blue-50" },
      { label: "Pending Reviews", value: pendingReview, icon: Clock, color: "text-amber-600 bg-amber-50" },
      { label: "Approved", value: approved, icon: CheckCircle2, color: "text-green-600 bg-green-50" },
      { label: "Returned", value: returned, icon: RotateCcw, color: "text-orange-600 bg-orange-50" },
    ];
  }, [requests]);

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${stat.color}`}>
              <stat.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="text-xl font-bold">{stat.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function PrincipalBudgetPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<BudgetRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingCycle, setPendingCycle] = useState<BudgetCycle | null>(null);
  const [activeCycle, setActiveCycle] = useState<BudgetCycle | null>(null);
  const [cycleRequests, setCycleRequests] = useState<BudgetRequest[]>([]);

  function load() {
    setIsLoading(true);
    fetch("/api/college/budget-requests")
      .then((r) => r.json() as Promise<{ requests: BudgetRequest[] }>)
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load budget requests" }))
      .finally(() => setIsLoading(false));
  }

  async function loadCycles() {
    try {
      const res = await collegeFetch("/api/college/budget-cycles");
      const d = (await res.json()) as { cycles?: BudgetCycle[]; error?: string };
      if (!res.ok) throw new Error(d.error ?? `Request failed (${res.status})`);

      const cycles = d.cycles ?? [];
      const pending = cycles.find((c) => c.status === "PENDING_APPROVAL") ?? null;
      const active = pending ?? cycles.find((c) => c.status === "APPROVED") ?? null;
      setPendingCycle(pending);
      setActiveCycle(active);
      if (!active) { setCycleRequests([]); return; }

      const res2 = await collegeFetch(`/api/college/budget-requests?budgetCycleId=${active.id}`);
      const d2 = (await res2.json()) as { requests?: BudgetRequest[]; error?: string };
      if (!res2.ok) throw new Error(d2.error ?? `Request failed (${res2.status})`);
      setCycleRequests(d2.requests ?? []);
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to load budget cycle", description: err instanceof Error ? err.message : undefined });
    }
  }

  useEffect(() => { load(); loadCycles(); }, []);

  const counts = useMemo(() => {
    const terminal = new Set(["PRINCIPAL_REJECTED", "FINANCE_REJECTED", "MANAGEMENT_REJECTED"]);
    const approved = new Set(["L1_FROZEN", "FINANCE_APPROVED"]);
    return {
      total: requests.length,
      pending: requests.filter((r) => !terminal.has(r.status) && !approved.has(r.status)).length,
      approved: requests.filter((r) => approved.has(r.status)).length,
      rejected: requests.filter((r) => terminal.has(r.status)).length,
    };
  }, [requests]);

  async function handleCycleAction(action: "APPROVE" | "REJECT" | "RETURN", remarks?: string) {
    if (!pendingCycle) return;
    try {
      const res = await collegeFetch(`/api/college/budget-cycles/${pendingCycle.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, remarks }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Action failed");
      }
      toast({
        variant: "success",
        title: action === "APPROVE" ? "Budget cycle approved — departments notified" : action === "REJECT" ? "Budget cycle rejected" : "Budget cycle returned to Finance",
      });
      load();
      loadCycles();
    } catch (err) {
      toast({ variant: "destructive", title: "Action failed", description: err instanceof Error ? err.message : undefined });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget"
        description="Review and verify budget requests submitted by department HODs"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { load(); loadCycles(); }} loading={isLoading}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            <Button size="sm" variant="destructive" onClick={() => router.push("/principal/budget/new")}>
              <AlertTriangle className="h-4 w-4 mr-1" />
              Raise Emergency Request
            </Button>
          </div>
        }
      />

      {pendingCycle && (
        <BudgetCycleApprovalCard cycle={pendingCycle} onAct={handleCycleAction} />
      )}

      {activeCycle && <CycleDeptStats requests={cycleRequests} />}

      <BudgetSummaryCards {...counts} />

      <BudgetRequestsList
        requests={requests}
        isLoading={isLoading}
        onSelectRequest={(row) => router.push(`/principal/budget/${row.id}`)}
      />
    </div>
  );
}
