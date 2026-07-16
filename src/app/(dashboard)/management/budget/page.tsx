"use client";

import { CollegesListView } from "@/components/management/CollegesListView";
import { EmergencyBudgetRequests } from "@/components/management/EmergencyBudgetRequests";

export default function ManagementBudgetCollegesPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Emergency Requests</h2>
        <p className="text-sm text-muted-foreground -mt-2">
          Emergency budget requests raised by Principals / Vice Principals across all colleges, awaiting your approval.
        </p>
        <EmergencyBudgetRequests />
      </div>

      <CollegesListView
        title="Budget"
        description="Select a college to view its budget"
        basePath="/management/budget"
      />
    </div>
  );
}
