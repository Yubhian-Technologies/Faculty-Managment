"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { BudgetSummaryCards } from "./BudgetSummaryCards";
import { BudgetRequestsList } from "./BudgetRequestsList";
import { BudgetRequestDetail } from "./BudgetRequestDetail";
import { EmergencyBudgetForm } from "./EmergencyBudgetForm";
import { toast } from "@/hooks/useToast";
import type { BudgetRequest } from "@/types";

export default function PrincipalBudgetPage() {
  const [requests, setRequests] = useState<BudgetRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<BudgetRequest | null>(null);
  const [showEmergencyForm, setShowEmergencyForm] = useState(false);
  const [editingEmergencyRequest, setEditingEmergencyRequest] = useState<BudgetRequest | null>(null);
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

  function handleActed() {
    setSelectedRequest(null);
    load();
  }

  function openNewEmergencyRequest() {
    setSelectedRequest(null);
    setEditingEmergencyRequest(null);
    setShowEmergencyForm(true);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function openEditEmergencyRequest(request: BudgetRequest) {
    setSelectedRequest(null);
    setEditingEmergencyRequest(request);
    setShowEmergencyForm(true);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function closeEmergencyForm() {
    setEditingEmergencyRequest(null);
    setShowEmergencyForm(false);
  }

  function handleEmergencySaved() {
    closeEmergencyForm();
    load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget"
        description="Review and verify budget requests submitted by department HODs"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} loading={isLoading}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            <Button size="sm" variant="destructive" onClick={openNewEmergencyRequest}>
              <AlertTriangle className="h-4 w-4 mr-1" />
              Raise Emergency Request
            </Button>
          </div>
        }
      />

      <BudgetSummaryCards {...counts} />

      <BudgetRequestsList
        requests={requests}
        isLoading={isLoading}
        onSelectRequest={setSelectedRequest}
      />

      <BudgetRequestDetail
        request={selectedRequest}
        onClose={() => setSelectedRequest(null)}
        onActed={handleActed}
        onEditEmergencyRequest={openEditEmergencyRequest}
      />

      {showEmergencyForm && (
        <div ref={formRef} className="space-y-4">
          <h2 className="text-lg font-semibold">
            {editingEmergencyRequest ? "Edit & Resubmit Emergency Request" : "Raise Emergency Budget Request"}
          </h2>
          <EmergencyBudgetForm
            editingRequest={editingEmergencyRequest}
            onCancel={closeEmergencyForm}
            onSaved={handleEmergencySaved}
          />
        </div>
      )}
    </div>
  );
}
