"use client";

import { GraduationCap } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export default function HODTrainingPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Training & FDPs" description="Workshops, seminars and development programs" />
      <Card><CardContent className="p-8"><EmptyState title="Training module coming soon" description="FDP registrations, workshops and training records will be available here." icon={<GraduationCap className="h-8 w-8" />} /></CardContent></Card>
    </div>
  );
}
