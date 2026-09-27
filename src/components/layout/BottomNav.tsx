"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { useAssignedInterviews } from "@/hooks/useAssignedInterviews";
import { usePrincipalPendingHiring } from "@/hooks/usePrincipalPendingHiring";
import { BOTTOM_NAV_ITEMS, isNavItemActive, filterVisibleNavItems, isPathHidden, type NavItem } from "./navConfig";
import { NavIcon } from "./NavIcon";

const INTERVIEW_NAV_ITEM: NavItem = {
  label: "Interviews",
  href: "/panel/interviews",
  iconName: "CalendarDays",
  roles: ["PANEL_MEMBER"],
};

// See Sidebar.tsx - same badge, mirrored here for the mobile bottom bar.
const PENDING_HIRING_HREF = "/principal/vacancies";

interface BottomNavProps {
  hiddenModules: string[];
  hiddenItems: string[];
}

export function BottomNav({ hiddenModules, hiddenItems }: BottomNavProps) {
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();
  const { hasInterviews } = useAssignedInterviews();
  const { pendingCount: pendingHiringCount } = usePrincipalPendingHiring();

  if (!user || user.role === "STUDENT") return null;

  const isClassLeader = user.role === "CLASS_LEADER" || pathname?.startsWith("/class-leader");

  const baseItems = isClassLeader
    ? filterVisibleNavItems(BOTTOM_NAV_ITEMS.CLASS_LEADER ?? [], hiddenModules, hiddenItems, user.realRole)
    : filterVisibleNavItems(BOTTOM_NAV_ITEMS[user.role] ?? [], hiddenModules, hiddenItems, user.realRole);

  // Faculty: inject Interviews after Home when assigned, keep total ≤ 5 slots — respects hidden
  const isInterviewHidden = isPathHidden(INTERVIEW_NAV_ITEM.href, user.role, hiddenModules, hiddenItems);
  const items: NavItem[] =
    user.role === "PANEL_MEMBER" && hasInterviews && !isInterviewHidden
      ? [baseItems[0], INTERVIEW_NAV_ITEM, ...baseItems.slice(1, 4)]
      : baseItems;

  if (items.length === 0) return null;

  // Floating tabbed bottom navbar for Class Leader in mobile view
  if (isClassLeader) {
    return (
      <nav
        aria-label="Class Leader Navigation"
        className="md:hidden fixed bottom-5 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2.5rem)] max-w-[340px] safe-area-pb"
      >
        <div className="bg-background/95 dark:bg-card/95 backdrop-blur-xl border border-border/80 shadow-2xl shadow-black/15 dark:shadow-black/60 rounded-full p-2 grid grid-flow-col auto-cols-fr gap-2 items-center">
          {items.map((item) => {
            const isActive = isNavItemActive(item, pathname, items);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center justify-center gap-2.5 py-3 px-4 rounded-full min-w-0 transition-all duration-200 select-none text-sm font-semibold tracking-tight",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/30 font-bold scale-[1.02]"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
                )}
              >
                <NavIcon
                  name={item.iconName}
                  className={cn("h-5 w-5 shrink-0 transition-transform duration-200", isActive ? "scale-110" : "opacity-80")}
                />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-background border-t safe-area-pb">
      <div className="flex items-stretch h-16">
        {items.map((item) => {
          const isActive = isNavItemActive(item, pathname, items);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 min-w-0 px-1 transition-colors",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <div className="relative">
                <NavIcon name={item.iconName} className="h-5 w-5 shrink-0" />
                {item.href === PENDING_HIRING_HREF && pendingHiringCount > 0 && (
                  <span className="absolute -top-1 -right-2 bg-red-500 text-white text-[9px] rounded-full h-4 min-w-4 px-0.5 flex items-center justify-center font-bold">
                    {pendingHiringCount > 9 ? "9+" : pendingHiringCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium truncate w-full text-center">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
