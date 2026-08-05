"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { useAuthStore } from "@/store/authStore";

export default function VicePrincipalDashboard() {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name?.split(" ")[0] ?? "Vice Principal"}`}
        description="Hiring Pipeline and Academic Management are available from the sidebar"
      />
    </div>
  );
}
