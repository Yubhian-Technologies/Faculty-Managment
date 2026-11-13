"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { ManagementLeaveApprovals } from "@/components/management/ManagementLeaveApprovals";

export default function ManagementLeaveApprovalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Approvals"
        description="Leave requests of Principals across all colleges. These are decided here, as no one within the college can approve them."
      />
      <ManagementLeaveApprovals />
    </div>
  );
}
