"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, CalendarClock, Hourglass } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BudgetSummaryCards } from "./BudgetSummaryCards";
import { BudgetForm } from "./BudgetForm";
import { BudgetRequestsTable } from "./BudgetRequestsTable";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatDate } from "@/lib/utils";
import { daysRemaining, type BudgetCycle, type BudgetRequest } from "@/types";

export default function HODBudgetPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<BudgetRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [activeCycle, setActiveCycle] = useState<BudgetCycle | null>(null);
  const isFirstRender = useRef(true);
  const dashboardRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  function load() {
    setIsLoading(true);
    fetch("/api/college/budget-requests")
      .then((r) => r.json() as Promise<{ requests: BudgetRequest[] }>)
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load budget requests" }))
      .finally(() => setIsLoading(false));
  }

  async function loadActiveCycle() {
    try {
      const res = await collegeFetch("/api/college/budget-cycles?status=APPROVED");
      const d = (await res.json()) as { cycles?: BudgetCycle[]; error?: string };
      if (!res.ok) throw new Error(d.error ?? `Request failed (${res.status})`);
      setActiveCycle(d.cycles?.[0] ?? null);
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to load budget cycle", description: err instanceof Error ? err.message : undefined });
    }
  }

  useEffect(() => { load(); loadActiveCycle(); }, []);

  // This department's own budget for the active cycle, if one's been seeded.
  const myCycleStub = useMemo(
    () => (activeCycle ? requests.find((r) => r.budgetCycleId === activeCycle.id) ?? null : null),
    [activeCycle, requests]
  );
  const cycleNeedsAction = !!myCycleStub && (myCycleStub.status === "PENDING_SUBMISSION" || myCycleStub.status === "RETURNED_TO_HOD");

  const requestCounts = useMemo(() => {
    const terminal = new Set(["PRINCIPAL_REJECTED", "FINANCE_REJECTED", "MANAGEMENT_REJECTED"]);
    const approved = new Set(["L1_FROZEN", "FINANCE_APPROVED"]);
    return {
      total: requests.length,
      pending: requests.filter((r) => !terminal.has(r.status) && !approved.has(r.status)).length,
      approved: requests.filter((r) => approved.has(r.status)).length,
      rejected: requests.filter((r) => terminal.has(r.status)).length,
    };
  }, [requests]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const target = showForm ? formRef.current : dashboardRef.current;
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [showForm]);

  const [editingRequest, setEditingRequest] = useState<BudgetRequest | null>(null);

  // If this department already has a pending cycle budget, "Create Budget"
  // fills that in instead of starting a blank ad-hoc request.
  function openNewRequest() {
    setEditingRequest(cycleNeedsAction ? myCycleStub : null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingRequest(null);
  }

  function handleSaved() {
    closeForm();
    load();
  }

  const remaining = activeCycle ? daysRemaining(activeCycle.submissionDeadline) : null;

  return (
    <div className="space-y-6">
      <div ref={dashboardRef}>
        <PageHeader
          title="Budget"
          description="View and manage department budget requests"
          actions={
            <Button variant="outline" size="sm" onClick={() => { load(); loadActiveCycle(); }} loading={isLoading}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
          }
        />
      </div>

      {activeCycle && (
        <Card className={cycleNeedsAction ? "border-primary/30" : undefined}>
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Active Budget Cycle</p>
                  <p className="text-sm font-semibold">{activeCycle.title}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Hourglass className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Submission Deadline</p>
                  <p className="text-sm font-semibold">
                    {formatDate(new Date(activeCycle.submissionDeadline))}
                    {remaining !== null && (
                      <span className="text-muted-foreground font-normal"> · {remaining < 0 ? "Closed" : `${remaining} day(s) left`}</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
            {cycleNeedsAction && !showForm && (
              <Button onClick={openNewRequest}>Create Budget</Button>
            )}
          </CardContent>
        </Card>
      )}

      <BudgetSummaryCards
        {...requestCounts}
        showForm={showForm}
        onNewRequest={openNewRequest}
      />

      <BudgetRequestsTable
        requests={requests}
        isLoading={isLoading}
        onEditRequest={(request) => router.push(`/hod/budget/${request.id}`)}
        onViewRequest={(request) => router.push(`/hod/budget/${request.id}`)}
      />

      {showForm && (
        <div ref={formRef} className="space-y-4">
          <h2 className="text-lg font-semibold">
            {editingRequest ? "Submit Department Budget" : "Create Budget Request"}
          </h2>
          <BudgetForm editingRequest={editingRequest} onCancel={closeForm} onSaved={handleSaved} />
        </div>
      )}
    </div>
  );
}
