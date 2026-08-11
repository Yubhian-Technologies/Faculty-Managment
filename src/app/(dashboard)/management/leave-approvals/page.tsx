"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { ManagementLeaveApprovals } from "@/components/management/ManagementLeaveApprovals";

export default function ManagementLeaveApprovalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Approvals"
        description="Principals' own leave requests, across every college - there's no one else within a college to decide these"
      />
      <ManagementLeaveApprovals />
    </div>
  );
}
