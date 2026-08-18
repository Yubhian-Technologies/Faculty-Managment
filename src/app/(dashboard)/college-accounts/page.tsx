"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { useAuthStore } from "@/store/authStore";

export default function CollegeAccountsDashboard() {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name ?? "College Accounts"}`}
        description="College Accounts - college accounts administration"
      />
      <p className="text-muted-foreground text-sm">College Accounts features are being set up. Check back soon.</p>
    </div>
  );
}
