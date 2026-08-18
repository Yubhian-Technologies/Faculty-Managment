"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { OfficePipelineBoard } from "./OfficePipelineBoard";

export default function CollegeOfficePipelinePage() {
  const [scope, setScope] = useState<"active" | "closed">("active");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hiring Pipeline"
        description={
          scope === "active"
            ? "Every hiring request across all departments, from raise to faculty account creation"
            : "Completed and rejected hiring requests"
        }
      />

      <div className="flex gap-2">
        <Button size="sm" variant={scope === "active" ? "default" : "outline"} onClick={() => setScope("active")}>
          Active
        </Button>
        <Button size="sm" variant={scope === "closed" ? "default" : "outline"} onClick={() => setScope("closed")}>
          Past Hirings
        </Button>
      </div>

      <OfficePipelineBoard scope={scope} />
    </div>
  );
}
