"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { BudgetSummaryCards } from "./BudgetSummaryCards";
import { BudgetForm } from "./BudgetForm";
import { BudgetRequestsTable } from "./BudgetRequestsTable";

export default function HODBudgetPage() {
  const [showForm, setShowForm] = useState(false);
  const isFirstRender = useRef(true);
  const dashboardRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // Placeholder-only: nothing can be submitted yet, so counts and the
  // requests list stay empty until the backend for this module exists.
  const requestCounts = { total: 0, pending: 0, approved: 0, rejected: 0 };

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const target = showForm ? formRef.current : dashboardRef.current;
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [showForm]);

  return (
    <div className="space-y-6">
      <div ref={dashboardRef}>
        <PageHeader title="Budget" description="View and manage department budget requests" />
      </div>

      <BudgetSummaryCards
        {...requestCounts}
        showForm={showForm}
        onNewRequest={() => setShowForm(true)}
      />

      <BudgetRequestsTable />

      {showForm && (
        <div ref={formRef} className="space-y-4">
          <h2 className="text-lg font-semibold">Create Budget Request</h2>
          <BudgetForm onCancel={() => setShowForm(false)} />
        </div>
      )}
    </div>
  );
}
