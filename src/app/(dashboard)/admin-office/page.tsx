"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { useAuthStore } from "@/store/authStore";

export default function AdminOfficeDashboard() {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name?.split(" ")[0] ?? "Admin Office"}`}
        description="Admin Office — location administrative support"
      />
      <p className="text-muted-foreground text-sm">Admin Office features are being set up. Check back soon.</p>
    </div>
  );
}
