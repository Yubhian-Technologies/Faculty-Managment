"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { BudgetDepartmentReport } from "@/components/shared/budget/BudgetDepartmentReport";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import type { BudgetRequest } from "@/types";

export default function FinanceBudgetReportPage() {
  const [requests, setRequests] = useState<BudgetRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function load() {
    setIsLoading(true);
    collegeFetch("/api/college/budget-requests")
      .then((r) => r.json() as Promise<{ requests: BudgetRequest[] }>)
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load budget requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget Report"
        description="Department-wise breakdown of Non Recurring and Recurring budget items"
        actions={
          <Button variant="outline" size="sm" onClick={load} loading={isLoading}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        }
      />

      <BudgetDepartmentReport requests={requests} isLoading={isLoading} />
    </div>
  );
}
