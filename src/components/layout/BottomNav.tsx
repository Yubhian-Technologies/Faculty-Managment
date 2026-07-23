"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { useAssignedInterviews } from "@/hooks/useAssignedInterviews";
import { BOTTOM_NAV_ITEMS, isNavItemActive, type NavItem } from "./navConfig";
import { NavIcon } from "./NavIcon";
import { useNotifications } from "@/hooks/useNotifications";
import { useUIStore } from "@/store/uiStore";

const INTERVIEW_NAV_ITEM: NavItem = {
  label: "Interviews",
  href: "/panel/interviews",
  iconName: "CalendarDays",
  roles: ["PANEL_MEMBER"],
};

export function BottomNav() {
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();
  const { unreadCount } = useNotifications();
  const { setNotificationDrawerOpen } = useUIStore();
  const { hasInterviews } = useAssignedInterviews();

  if (!user || user.role === "STUDENT") return null;

  const baseItems = BOTTOM_NAV_ITEMS[user.role] ?? [];
  // Faculty: inject Interviews after Home when assigned, keep total ≤ 5 slots
  const items: NavItem[] =
    user.role === "PANEL_MEMBER" && hasInterviews
      ? [baseItems[0], INTERVIEW_NAV_ITEM, ...baseItems.slice(1, 4)]
      : baseItems;

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
              <NavIcon name={item.iconName} className="h-5 w-5 shrink-0" />
              <span className="text-[10px] font-medium truncate w-full text-center">
                {item.label}
              </span>
            </Link>
          );
        })}
        {/* Notification tab */}
        <button
          onClick={() => setNotificationDrawerOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 min-w-0 px-1 text-muted-foreground relative"
        >
          <div className="relative">
            <NavIcon name="Bell" className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] rounded-full h-4 w-4 flex items-center justify-center font-bold">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </div>
          <span className="text-[10px] font-medium">Alerts</span>
        </button>
      </div>
    </nav>
  );
}
