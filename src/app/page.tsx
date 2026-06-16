"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { ROLE_DASHBOARD_PATHS } from "@/types";
import { DashboardSkeleton } from "@/components/shared/SkeletonLoader";

export default function RootPage() {
  const { user, isLoading } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (user) {
      router.replace(ROLE_DASHBOARD_PATHS[user.role] ?? "/hod");
    } else {
      router.replace("/login");
    }
  }, [user, isLoading, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-4xl px-4">
        <DashboardSkeleton />
      </div>
    </div>
  );
}
