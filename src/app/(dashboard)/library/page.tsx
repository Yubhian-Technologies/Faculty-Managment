"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { useAuthStore } from "@/store/authStore";
import { useFacultyDisplayNames } from "@/hooks/useFacultyDisplayNames";

export default function LibraryDashboard() {
  const user = useAuthStore((s) => s.user);
  const { nameFor } = useFacultyDisplayNames();
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user ? nameFor("dashboardName", { uid: user.uid }, user.name) : "Library"}`}
        description="Library - college library administration"
      />
      <p className="text-muted-foreground text-sm">Library features are being set up. Check back soon.</p>
    </div>
  );
}
