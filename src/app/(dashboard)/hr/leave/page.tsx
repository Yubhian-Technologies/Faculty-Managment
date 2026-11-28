"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { LeaveProfileView } from "@/components/leave/LeaveProfileView";

export default function HrLeavePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Leave" description="Leave balance and leave request history." />
      <LeaveProfileView applyHref="/hr/leave/apply" historyBaseHref="/hr/leave/history" />
    </div>
  );
}
