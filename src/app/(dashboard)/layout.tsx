"use client";

import { useEffect } from "react";
import { useRouter, usePathname, notFound } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav, hasBottomNav } from "@/components/layout/BottomNav";
import { MobileDrawer } from "@/components/layout/MobileDrawer";
import { TopBar } from "@/components/layout/TopBar";
import { SummerHolidayBanner } from "@/components/layout/SummerHolidayBanner";
import { ReadOnlyAccessGate } from "@/components/layout/ReadOnlyAccessGate";
import { readOnlyHiddenHrefs } from "@/components/layout/readOnlyNav";
import { isPathHidden } from "@/components/layout/navConfig";
import { useAuthStore } from "@/store/authStore";
import { useNavVisibility } from "@/hooks/useNavVisibility";
import { useSessionRevocationWatch } from "@/hooks/useSessionRevocationWatch";
import { DashboardSkeleton } from "@/components/shared/SkeletonLoader";

// Pages reached only from a button on another page have no nav item, so Nav
// Visibility has no checkbox for them and a stale saved entry can never be
// cleared. They follow their parent page's visibility instead (same pairing as
// SUB_PAGE_PARENT in navConfig.ts, used there for the active highlight).
const SUB_PAGE_VISIBILITY_PARENT: Record<string, string> = {
  "/hod/assignment-requests": "/hod/teaching-assignments",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const { hiddenModules, hiddenItems, loading: navLoading } = useNavVisibility();
  // A login signed out everywhere (e.g. its college email was changed) is signed out here too, within about a minute.
  useSessionRevocationWatch(!!user);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [user, isLoading, router]);

  if (isLoading || navLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-full max-w-4xl px-4">
          <DashboardSkeleton />
        </div>
      </div>
    );
  }

  if (!user) return null;

  if (isPathHidden(SUB_PAGE_VISIBILITY_PARENT[pathname] ?? pathname, user.role, hiddenModules, hiddenItems)) {
    notFound();
  }

  // A read-only person (RESIGNED/RETIRED faculty) only sees the menu entries they can open. Applied to the
  // menus only - NOT to the notFound() check above - so visiting a blocked page directly shows the read-only
  // notice (ReadOnlyAccessGate) instead of a 404.
  const navHiddenItems = user.readOnlyAccess ? [...hiddenItems, ...readOnlyHiddenHrefs()] : hiddenItems;

  return (
    <div className="min-h-screen bg-muted/30">
      <Sidebar hiddenModules={hiddenModules} hiddenItems={navHiddenItems} />
      <MobileDrawer hiddenModules={hiddenModules} hiddenItems={navHiddenItems} />
      <div className="md:ml-64 flex flex-col min-h-screen">
        <TopBar hiddenItems={navHiddenItems} />
        <SummerHolidayBanner />
        <main className={`flex-1 p-4 md:p-6 md:pb-6 max-w-7xl mx-auto w-full ${hasBottomNav(user.role, pathname) ? "pb-24" : "pb-6"}`}>
          <ReadOnlyAccessGate>{children}</ReadOnlyAccessGate>
        </main>
        <footer className="hidden md:flex items-center justify-between px-6 py-3 border-t bg-background text-xs text-muted-foreground">
          <span>© 2026 Sri Vishnu Educational Society. All rights reserved.</span>
          <span>Developed by Yubhian Technologies LLP</span>
        </footer>
      </div>
      <BottomNav hiddenModules={hiddenModules} hiddenItems={navHiddenItems} />
    </div>
  );
}
