"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { PipelineBoard } from "../pipeline/PipelineBoard";

export default function PastHiringsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Past Hirings"
        description="Completed and rejected hiring requests"
      />
      <PipelineBoard scope="closed" />
    </div>
  );
}
