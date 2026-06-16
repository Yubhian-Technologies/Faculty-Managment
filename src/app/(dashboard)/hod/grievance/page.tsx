"use client";

import { AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export default function HODGrievancePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Grievance" description="Raise and track grievance requests" />
      <Card><CardContent className="p-8"><EmptyState title="Grievance module coming soon" description="Submit and track the status of your grievance requests here." icon={<AlertCircle className="h-8 w-8" />} /></CardContent></Card>
    </div>
  );
}
