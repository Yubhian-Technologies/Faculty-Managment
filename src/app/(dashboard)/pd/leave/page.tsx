"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { LeaveProfileView } from "@/components/leave/LeaveProfileView";

export default function PdLeavePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Leave" description="Leave balance and leave request history." />
      <LeaveProfileView applyHref="/pd/leave/apply" historyBaseHref="/pd/leave/history" />
    </div>
  );
}
