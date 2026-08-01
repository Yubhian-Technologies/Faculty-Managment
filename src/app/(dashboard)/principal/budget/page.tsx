"use client";

import { PiggyBank } from "lucide-react";
import { ComingSoon } from "@/components/shared/ComingSoon";

export default function PrincipalBudgetPage() {
  return (
    <ComingSoon
      icon={PiggyBank}
      title="Budget"
      description="Departmental budget requests, approvals, and fund tracking"
    />
  );
}
