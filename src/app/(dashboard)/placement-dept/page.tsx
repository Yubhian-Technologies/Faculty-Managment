"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { useAuthStore } from "@/store/authStore";

export default function PlacementDeptDashboard() {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name?.split(" ")[0] ?? "Placement Department"}`}
        description="Placement Department - college placement & recruitment support"
      />
      <p className="text-muted-foreground text-sm">Placement Department features are being set up. Check back soon.</p>
    </div>
  );
}
