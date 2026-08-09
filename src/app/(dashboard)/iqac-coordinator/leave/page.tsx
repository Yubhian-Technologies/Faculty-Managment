"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { LeaveProfileView } from "@/components/leave/LeaveProfileView";

export default function IqacCoordinatorLeavePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Leave" description="Your leave balances and request history" />
      <LeaveProfileView applyHref="/iqac-coordinator/leave/apply" historyBaseHref="/iqac-coordinator/leave/history" />
    </div>
  );
}
