"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { LeaveApprovalQueue } from "@/components/leave/LeaveApprovalQueue";

export default function PrincipalLeaveApprovalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Leave Approvals" description="Requests HOD-approved and awaiting final sign-off" />
      <LeaveApprovalQueue />
    </div>
  );
}
