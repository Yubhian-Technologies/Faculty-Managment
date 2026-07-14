"use client";

import { CollegesListView } from "@/components/management/CollegesListView";

export default function ManagementBudgetCollegesPage() {
  return (
    <CollegesListView
      title="Budget"
      description="Select a college to view its budget"
      basePath="/management/budget"
    />
  );
}
