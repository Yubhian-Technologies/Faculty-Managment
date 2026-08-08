"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { PrincipalPipelineBoard } from "./PrincipalPipelineBoard";

export default function PrincipalVacanciesPage() {
  const [scope, setScope] = useState<"active" | "closed">("active");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hiring Requests"
        description={
          scope === "active"
            ? "Review and approve HOD and Vice Principal hiring requests — from request to hiring results in one view"
            : "Completed and rejected hiring requests"
        }
      />

      <div className="flex gap-2">
        <Button size="sm" variant={scope === "active" ? "default" : "outline"} onClick={() => setScope("active")}>
          Active
        </Button>
        <Button size="sm" variant={scope === "closed" ? "default" : "outline"} onClick={() => setScope("closed")}>
          Past
        </Button>
      </div>

      <PrincipalPipelineBoard scope={scope} />
    </div>
  );
}
