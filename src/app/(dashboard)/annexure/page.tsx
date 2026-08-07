"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { useAuthStore } from "@/store/authStore";

export default function AnnexureDashboard() {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name?.split(" ")[0] ?? "Annexure"}`}
        description="Annexure — department support"
      />
      <p className="text-muted-foreground text-sm">Annexure features are being set up. Check back soon.</p>
    </div>
  );
}
