"use client";

import { FileText } from "lucide-react";
import { ComingSoon } from "@/components/shared/ComingSoon";

export default function PrincipalBudgetReportPage() {
  return (
    <ComingSoon
      icon={FileText}
      title="Budget Report"
      description="Department-wise breakdown of Non Recurring and Recurring budget items"
    />
  );
}
