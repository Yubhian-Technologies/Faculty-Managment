"use client";

import { CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export default function PrincipalLeaveApprovalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Approvals"
        description="Review and approve leave requests from HODs"
      />
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <CalendarClock className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">HOD leave approval queue coming soon</p>
          <p className="text-xs text-muted-foreground">Faculty leave is handled by HODs — this view shows HOD leave requests awaiting your approval</p>
        </CardContent>
      </Card>
    </div>
  );
}
