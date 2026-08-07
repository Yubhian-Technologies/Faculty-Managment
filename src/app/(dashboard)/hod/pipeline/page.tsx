"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { PipelineBoard } from "./PipelineBoard";

export default function HiringPipelinePage() {
  const [scope, setScope] = useState<"active" | "closed">("active");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hiring Pipeline"
        description={
          scope === "active"
            ? "Active positions — from request to hiring results in one view"
            : "Completed and rejected hiring requests"
        }
        actions={
          <Button asChild>
            <Link href="/hod/vacancy/new">
              <Plus className="h-4 w-4 mr-1" />
              New Request
            </Link>
          </Button>
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

      <PipelineBoard scope={scope} />
    </div>
  );
}
