"use client";

import { CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export default function HODLeaveApprovalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Leave Approvals" description="Review and approve faculty leave applications" />
      <Card><CardContent className="p-8">
        <EmptyState title="Leave approvals coming soon" description="Department faculty leave applications will appear here for your approval." icon={<CalendarClock className="h-8 w-8" />} />
      </CardContent></Card>
    </div>
  );
}
