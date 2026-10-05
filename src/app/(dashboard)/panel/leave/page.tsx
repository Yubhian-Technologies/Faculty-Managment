"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { LeaveProfileView } from "@/components/leave/LeaveProfileView";
import { useAuthStore } from "@/store/authStore";

export default function PanelLeavePage() {
  // A RESIGNED/RETIRED faculty member (read-only access) can look at their leave history but not apply:
  // omitting applyHref is how LeaveProfileView already drops the Apply button.
  const readOnly = useAuthStore((s) => s.user?.readOnlyAccess === true);
  return (
    <div className="space-y-6">
      <PageHeader title="My Leave" description="Your leave balances and request history" />
      <LeaveProfileView applyHref={readOnly ? undefined : "/panel/leave/apply"} historyBaseHref="/panel/leave/history" />
    </div>
  );
}
