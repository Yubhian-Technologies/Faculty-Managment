"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { ROLE_DASHBOARD_PATHS } from "@/types";
import { DashboardSkeleton } from "@/components/shared/SkeletonLoader";
import { LandingPage } from "@/components/landing/LandingPage";

export default function RootPage() {
  const { user, isLoading } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (user) {
      router.replace(ROLE_DASHBOARD_PATHS[user.role] ?? "/hod");
    }
  }, [user, isLoading, router]);

  // Authenticated visitors are redirected to their dashboard above; while that's
  // resolving (or while auth is still hydrating), show the existing skeleton
  // instead of flashing the landing page first.
  if (isLoading || user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-full max-w-4xl px-4">
          <DashboardSkeleton />
        </div>
      </div>
    );
  }

  return <LandingPage />;
}
