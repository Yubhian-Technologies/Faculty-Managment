"use client";

import { TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export default function AppraisalPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance Appraisal"
        description="Self-appraisal and HOD / Principal review"
      />

      <Card>
        <CardContent className="p-6">
          <EmptyState
            title="Appraisal module coming soon"
            description="Submit your self-appraisal for teaching effectiveness, research, and administrative contributions. Track HOD and Principal review status."
            icon={<TrendingUp className="h-8 w-8" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}
