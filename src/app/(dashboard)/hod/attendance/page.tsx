"use client";

import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export default function HODAttendancePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Attendance" description="View your attendance records and monthly summary" />
      <Card><CardContent className="p-8"><EmptyState title="Attendance module coming soon" description="Monthly attendance summary and daily records will be available here." icon={<ClipboardCheck className="h-8 w-8" />} /></CardContent></Card>
    </div>
  );
}
