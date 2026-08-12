"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { LeaveHistoryReport } from "@/components/leave/LeaveHistoryReport";
import { ActiveLeaveNowCard } from "@/components/leave/ActiveLeaveNowCard";

export default function HodLeaveHistoryPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave History"
        description="Monthly leave register for your department - click a faculty member to view their full history"
      />
      <ActiveLeaveNowCard />
      <LeaveHistoryReport
        apiUrl="/api/college/leave-history-report"
        queryKey={["hod-leave-history-report"]}
        employeeHrefBase="/hod/leave-history"
        emptyTitle="No faculty with a login in your department yet"
      />
    </div>
  );
}
