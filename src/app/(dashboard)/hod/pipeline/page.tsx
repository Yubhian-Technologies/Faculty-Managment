"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { PipelineBoard } from "./PipelineBoard";

export default function HiringPipelinePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Hiring Pipeline"
        description="Active positions — from request to hiring decision in one view"
        actions={
          <Button asChild>
            <Link href="/hod/vacancy/new">
              <Plus className="h-4 w-4 mr-1" />
              New Request
            </Link>
          </Button>
        }
      />
      <PipelineBoard scope="active" />
    </div>
  );
}
