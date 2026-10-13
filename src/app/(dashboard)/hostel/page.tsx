"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { useAuthStore } from "@/store/authStore";

export default function HostelDashboard() {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name ?? "Hostel"}`}
        description="Hostel - student hostel administration"
      />
      <p className="text-muted-foreground text-sm">Hostel features are being set up. Check back soon.</p>
    </div>
  );
}
