"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { LeaveProfileView } from "@/components/leave/LeaveProfileView";

export default function TAndPLeavePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Leave" description="Your leave balances and request history" />
      <LeaveProfileView applyHref="/t-and-p/leave/apply" historyBaseHref="/t-and-p/leave/history" />
    </div>
  );
}
