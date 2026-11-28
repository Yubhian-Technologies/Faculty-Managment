"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { LeaveProfileView } from "@/components/leave/LeaveProfileView";

export default function CollegeAccountsLeavePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Leave" description="Leave balance and leave request history." />
      <LeaveProfileView applyHref="/college-accounts/leave/apply" historyBaseHref="/college-accounts/leave/history" />
    </div>
  );
}
