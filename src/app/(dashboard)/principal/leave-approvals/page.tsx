"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { LeaveApprovalQueue } from "@/components/leave/LeaveApprovalQueue";

export default function PrincipalLeaveApprovalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Leave Approvals" description="Requests approved by the HOD and awaiting final approval." />
      <LeaveApprovalQueue />
    </div>
  );
}
