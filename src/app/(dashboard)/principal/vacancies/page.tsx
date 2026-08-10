"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { PrincipalPipelineBoard } from "./PrincipalPipelineBoard";
import { ActionQueueView } from "./ActionQueueView";

export default function PrincipalVacanciesPage() {
  const [scope, setScope] = useState<"active" | "closed">("active");
  const [view, setView] = useState<"pipeline" | "queue">("pipeline");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hiring Pipeline"
        description={
          scope === "active"
            ? "Review and approve HOD and Vice Principal hiring requests — from request to hiring results in one view"
            : "Completed and rejected hiring requests"
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button size="sm" variant={scope === "active" ? "default" : "outline"} onClick={() => setScope("active")}>
            Active
          </Button>
          <Button size="sm" variant={scope === "closed" ? "default" : "outline"} onClick={() => setScope("closed")}>
            Past
          </Button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={view === "pipeline" ? "default" : "outline"} onClick={() => setView("pipeline")}>
            Pipeline View
          </Button>
          <Button size="sm" variant={view === "queue" ? "default" : "outline"} onClick={() => setView("queue")}>
            Action Queue
          </Button>
        </div>
      </div>

      {view === "pipeline" ? (
        <PrincipalPipelineBoard scope={scope} />
      ) : (
        <ActionQueueView scope={scope === "closed" ? "past" : "active"} />
      )}
    </div>
  );
}
