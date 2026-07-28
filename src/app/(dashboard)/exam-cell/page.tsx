"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { useAuthStore } from "@/store/authStore";

export default function ExamCellDashboard() {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name?.split(" ")[0] ?? "Exam Cell"}`}
        description="Exam Cell — college examination administration"
      />
      <p className="text-muted-foreground text-sm">Exam Cell features are being set up. Check back soon.</p>
    </div>
  );
}
