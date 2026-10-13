"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { LeaveProfileView } from "@/components/leave/LeaveProfileView";

export default function HostelLeavePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Leave" description="Your leave balances and request history" />
      <LeaveProfileView applyHref="/hostel/leave/apply" historyBaseHref="/hostel/leave/history" />
    </div>
  );
}
