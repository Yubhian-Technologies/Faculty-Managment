"use client";

import { TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export default function HODAppraisalPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Appraisal" description="Performance review and self-assessment" />
      <Card><CardContent className="p-8"><EmptyState title="Appraisal module coming soon" description="Annual performance appraisal and self-assessment forms will be available here." icon={<TrendingUp className="h-8 w-8" />} /></CardContent></Card>
    </div>
  );
}
