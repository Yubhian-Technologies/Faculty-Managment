"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { IndentSummaryCards } from "./IndentSummaryCards";
import { IndentForm } from "./IndentForm";
import { IndentRequestsTable } from "./IndentRequestsTable";
import { IndentRequestDetail } from "./IndentRequestDetail";
import { toast } from "@/hooks/useToast";
import type { IndentRequest } from "@/types";

export default function HODIndentsPage() {
  const [requests, setRequests] = useState<IndentRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRequest, setEditingRequest] = useState<IndentRequest | null>(null);
  const [viewingRequest, setViewingRequest] = useState<IndentRequest | null>(null);
  const isFirstRender = useRef(true);
  const dashboardRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  function load() {
    setIsLoading(true);
    fetch("/api/college/indent-requests")
      .then((r) => r.json() as Promise<{ requests: IndentRequest[] }>)
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load indent requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  const requestCounts = useMemo(() => {
    const terminal = new Set(["REJECTED_BY_PURCHASE", "REJECTED"]);
    return {
      total: requests.length,
      pending: requests.filter((r) => !terminal.has(r.status) && r.status !== "APPROVED").length,
      approved: requests.filter((r) => r.status === "APPROVED").length,
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

  function openEditRequest(request: IndentRequest) {
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
          title="Indent Requests"
          description="Raise and track indents against your department's budget"
          actions={
            <Button variant="outline" size="sm" onClick={load} loading={isLoading}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
          }
        />
      </div>

      <IndentSummaryCards {...requestCounts} showForm={showForm} onNewRequest={openNewRequest} />

      <IndentRequestsTable
        requests={requests}
        isLoading={isLoading}
        onEditRequest={openEditRequest}
        onViewRequest={setViewingRequest}
      />

      <IndentRequestDetail
        request={viewingRequest}
        onClose={() => setViewingRequest(null)}
        onEditRequest={openEditRequest}
      />

      {showForm && (
        <div ref={formRef} className="space-y-4">
          <h2 className="text-lg font-semibold">
            {editingRequest ? "Edit & Resubmit Indent" : "Raise Indent Request"}
          </h2>
          <IndentForm editingRequest={editingRequest} onCancel={closeForm} onSaved={handleSaved} />
        </div>
      )}
    </div>
  );
}
