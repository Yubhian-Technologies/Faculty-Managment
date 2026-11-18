"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { LeaveTypeRulesCard } from "@/components/leave/LeaveTypeRulesCard";

// Super Admin > Leave Policy: the leave rules for every college (lib/leave/groupLeavePolicy.ts).
export default function SuperAdminLeavePolicyPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Policy"
        description="Leave rules for all colleges - half day, days per year, carry forward, limits and reasons. Lock a rule to make it the same for every college."
      />
      <LeaveTypeRulesCard mode="group" />
    </div>
  );
}
