"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { BudgetSummaryCards } from "./BudgetSummaryCards";
import { BudgetForm } from "./BudgetForm";
import { BudgetRequestsTable } from "./BudgetRequestsTable";
import { BudgetRequestDetail } from "./BudgetRequestDetail";
import { toast } from "@/hooks/useToast";
import type { BudgetRequest } from "@/types";

export default function HODBudgetPage() {
  const [requests, setRequests] = useState<BudgetRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRequest, setEditingRequest] = useState<BudgetRequest | null>(null);
  const [viewingRequest, setViewingRequest] = useState<BudgetRequest | null>(null);
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

  useEffect(() => { load(); }, []);

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

  function openNewRequest() {
    setEditingRequest(null);
    setShowForm(true);
  }

  function openEditRequest(request: BudgetRequest) {
    setViewingRequest(null);
    setEditingRequest(request);
    setShowForm(true);
  }

  function closeForm() {
    setEditingRequest(null);
    setShowForm(false);
  }

  function handleSaved() {
    closeForm();
    load();
  }

  return (
    <div className="space-y-6">
      <div ref={dashboardRef}>
        <PageHeader
          title="Budget"
          description="View and manage department budget requests"
          actions={
            <Button variant="outline" size="sm" onClick={load} loading={isLoading}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
          }
        />
      </div>

      <BudgetSummaryCards
        {...requestCounts}
        showForm={showForm}
        onNewRequest={openNewRequest}
      />

      <BudgetRequestsTable
        requests={requests}
        isLoading={isLoading}
        onEditRequest={openEditRequest}
        onViewRequest={setViewingRequest}
      />

      <BudgetRequestDetail
        request={viewingRequest}
        onClose={() => setViewingRequest(null)}
        onEditRequest={openEditRequest}
      />

      {showForm && (
        <div ref={formRef} className="space-y-4">
          <h2 className="text-lg font-semibold">
            {editingRequest ? "Edit & Resubmit Budget Request" : "Create Budget Request"}
          </h2>
          <BudgetForm editingRequest={editingRequest} onCancel={closeForm} onSaved={handleSaved} />
        </div>
      )}
    </div>
  );
}
