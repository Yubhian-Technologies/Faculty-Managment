"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { ActionQueueView } from "../vacancies/ActionQueueView";

// Kept as a standalone route (no longer in the sidebar - folded into the
// "Action Queue" tab on /principal/vacancies) because existing notification
// links and PrincipalDashboardHome's shortcuts already point here.
export default function PrincipalInterviewsPage() {
  const [scope, setScope] = useState<"active" | "past">("active");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Interviews & Decisions"
        description="Review HOD interview panel proposals and make final hiring decisions"
      />

      <div className="flex gap-2">
        <Button size="sm" variant={scope === "active" ? "default" : "outline"} onClick={() => setScope("active")}>
          Active
        </Button>
        <Button size="sm" variant={scope === "past" ? "default" : "outline"} onClick={() => setScope("past")}>
          Past
        </Button>
      </div>

      <ActionQueueView scope={scope} />
    </div>
  );
}
