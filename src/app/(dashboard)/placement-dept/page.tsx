"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { useAuthStore } from "@/store/authStore";
import { useFacultyDisplayNames } from "@/hooks/useFacultyDisplayNames";

export default function PlacementDeptDashboard() {
  const user = useAuthStore((s) => s.user);
  const { nameFor } = useFacultyDisplayNames();
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user ? nameFor("dashboardName", { uid: user.uid }, user.name) : "Placement Department"}`}
        description="Placement Department - college placement & recruitment support"
      />
      <p className="text-muted-foreground text-sm">Placement Department features are being set up. Check back soon.</p>
    </div>
  );
}
