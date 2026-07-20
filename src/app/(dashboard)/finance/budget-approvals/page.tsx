"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ClipboardCheck, Building2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ApprovalWorkflowList } from "@/components/finance/ApprovalWorkflowList";
import { IncomingBudgetRequests } from "./IncomingBudgetRequests";
import { EmergencyReportUpload } from "./EmergencyReportUpload";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatCurrency, formatDate, toDate } from "@/lib/utils";
import type { FinanceBudgetRequest } from "@/types";

type Row = FinanceBudgetRequest & { id: string; status: string };

export default function FinanceBudgetApprovalsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function load() {
    setIsLoading(true);
    collegeFetch("/api/college/finance-budget-requests")
      .then((r) => r.json() as Promise<{ requests: Row[] }>)
      .then((d) => {
        const sorted = [...(d.requests ?? [])].sort(
          (a, b) => (toDate(a.createdAt)?.getTime() ?? 0) - (toDate(b.createdAt)?.getTime() ?? 0)
        );
        setRequests(sorted);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load budget requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  const pending = requests.filter((r) => r.status === "PENDING");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget Approvals"
        description="Review, approve, reject, or return department budget requests"
        actions={
          <Button onClick={() => router.push("/finance/budget-approvals/new")}>
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

      <div className="space-y-3">
        <h2 className="text-base font-semibold">Incoming from Departments</h2>
        <p className="text-sm text-muted-foreground -mt-2">
          Requests HODs submitted and Principals verified (Level 1 freeze) — approving one creates the budget automatically.
        </p>
        <IncomingBudgetRequests />
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-semibold">Emergency Reports</h2>
        <p className="text-sm text-muted-foreground -mt-2">
          Approved Non-Goods emergency requests — send a report to the requesting Principal / Vice Principal to view.
        </p>
        <EmergencyReportUpload />
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-semibold">Manually Logged Requests</h2>
        <ApprovalWorkflowList
          items={requests}
          isLoading={isLoading}
          patchUrl={(item) => `/api/college/finance-budget-requests/${item.id}`}
          onChanged={load}
          emptyTitle="No budget requests"
          emptyDescription="Log a budget request received from a department to start the approval workflow."
          icon={<ClipboardCheck className="h-8 w-8" />}
          renderSummary={(item) => (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-semibold text-sm">{item.department}</span>
                <Badge variant="secondary" className="text-xs">{formatCurrency(item.requestedAmount)}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{item.purpose}</p>
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
    </div>
  );
}
