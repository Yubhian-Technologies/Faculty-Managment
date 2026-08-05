"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { useAuthStore } from "@/store/authStore";

export default function LibraryDashboard() {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name?.split(" ")[0] ?? "Library"}`}
        description="Library — college library administration"
      />
      <p className="text-muted-foreground text-sm">Library features are being set up. Check back soon.</p>
    </div>
  );
}
