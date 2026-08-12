"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { LeaveProfileView } from "@/components/leave/LeaveProfileView";

export default function WebmasterLeavePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Leave" description="Your leave balances and request history" />
      <LeaveProfileView applyHref="/webmaster/leave/apply" historyBaseHref="/webmaster/leave/history" />
    </div>
  );
}
