"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { MobileDrawer } from "@/components/layout/MobileDrawer";
import { TopBar } from "@/components/layout/TopBar";
import { useAuthStore } from "@/store/authStore";
import { DashboardSkeleton } from "@/components/shared/SkeletonLoader";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-full max-w-4xl px-4">
          <DashboardSkeleton />
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-muted/30">
      <Sidebar />
      <MobileDrawer />
      <div className="md:ml-64 flex flex-col min-h-screen">
        <TopBar />
        <main className="flex-1 p-4 md:p-6 pb-24 md:pb-6 max-w-7xl mx-auto w-full">
          {children}
        </main>
        <footer className="hidden md:flex items-center justify-between px-6 py-3 border-t bg-background text-xs text-muted-foreground">
          <span>© 2026 Sri Vishnu Educational Society. All rights reserved.</span>
          <span>Developed by Yubhian Technologies LLP</span>
        </footer>
      </div>
      <BottomNav />
    </div>
  );
}
