"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { MyDashboardOverview } from "@/components/dashboard/MyDashboardOverview";
import { useAuthStore } from "@/store/authStore";

export default function CollegeStaffDashboard() {
  const user = useAuthStore((s) => s.user);
  const title = user?.designation;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user?.name ?? "there"}`}
        description={title ?? "College Staff"}
      />
      <MyDashboardOverview />
    </div>
  );
}
