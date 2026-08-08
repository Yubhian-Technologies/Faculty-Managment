"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { LeaveApprovalQueue } from "@/components/leave/LeaveApprovalQueue";

export default function HodLeaveApprovalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Leave Approvals" description="Pending leave requests from your department" />
      <LeaveApprovalQueue />
    </div>
  );
}
