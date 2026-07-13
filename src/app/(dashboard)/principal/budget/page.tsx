"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { BudgetSummaryCards } from "./BudgetSummaryCards";
import { BudgetRequestsList } from "./BudgetRequestsList";
import { BudgetRequestDetail } from "./BudgetRequestDetail";
import { MOCK_BUDGET_REQUESTS, type BudgetRequest } from "./mockBudgetRequests";

export default function PrincipalBudgetPage() {
  const [selectedRequest, setSelectedRequest] = useState<BudgetRequest | null>(null);

  const counts = useMemo(() => {
    const requests = MOCK_BUDGET_REQUESTS;
    return {
      total: requests.length,
      pending: requests.filter((r) => r.status === "PENDING").length,
      approved: requests.filter((r) => r.status === "APPROVED").length,
      rejected: requests.filter((r) => r.status === "REJECTED").length,
    };
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget"
        description="Review and approve budget requests submitted by department HODs"
      />

      <BudgetSummaryCards {...counts} />

      <BudgetRequestsList
        requests={MOCK_BUDGET_REQUESTS}
        onSelectRequest={setSelectedRequest}
      />

      <BudgetRequestDetail
        request={selectedRequest}
        onClose={() => setSelectedRequest(null)}
      />
    </div>
  );
}
