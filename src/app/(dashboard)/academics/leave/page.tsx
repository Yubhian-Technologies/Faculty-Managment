"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { LeaveProfileView } from "@/components/leave/LeaveProfileView";

export default function AcademicsLeavePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Leave" description="Your leave balances and request history" />
      <LeaveProfileView applyHref="/academics/leave/apply" historyBaseHref="/academics/leave/history" />
    </div>
  );
}
