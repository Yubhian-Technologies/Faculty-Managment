"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { useAuthStore } from "@/store/authStore";

export default function PdDashboard() {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name ?? "Physical Education Director"}`}
        description="Physical Education - sports kit & equipment clearance"
      />
      <p className="text-muted-foreground text-sm">Physical Education features are being set up. Check back soon.</p>
    </div>
  );
}
