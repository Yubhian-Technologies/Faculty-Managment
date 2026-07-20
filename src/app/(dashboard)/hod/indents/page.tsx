"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { IndentSummaryCards } from "./IndentSummaryCards";
import { IndentForm } from "./IndentForm";
import { IndentRequestsTable } from "./IndentRequestsTable";
import { toast } from "@/hooks/useToast";
import type { IndentRequest } from "@/types";

export default function HODIndentsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<IndentRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
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
      pending: requests.filter((r) => !terminal.has(r.status) && r.status !== "APPROVED" && r.status !== "COMPLETED").length,
      approved: requests.filter((r) => r.status === "APPROVED").length,
      completed: requests.filter((r) => r.status === "COMPLETED").length,
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
    setShowForm(true);
  }

  function closeForm() {
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
        onEditRequest={(request) => router.push(`/hod/indents/${request.id}`)}
        onViewRequest={(request) => router.push(`/hod/indents/${request.id}`)}
      />

      {showForm && (
        <div ref={formRef} className="space-y-4">
          <h2 className="text-lg font-semibold">Raise Indent Request</h2>
          <IndentForm editingRequest={null} onCancel={closeForm} onSaved={handleSaved} />
        </div>
      )}
    </div>
  );
}
