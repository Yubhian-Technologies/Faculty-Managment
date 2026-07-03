"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, LogOut, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { useUIStore } from "@/store/uiStore";
import { useNotifications } from "@/hooks/useNotifications";
import { useAuth } from "@/hooks/useAuth";
import { useAssignedInterviews } from "@/hooks/useAssignedInterviews";
import { useAssignedCoordinator } from "@/hooks/useAssignedCoordinator";
import { getNavItemsForRole, type NavItem } from "./navConfig";
import { NavIcon } from "./NavIcon";
import { ROLE_LABELS } from "@/types";
import { getInitials } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const INTERVIEW_NAV_ITEM: NavItem = {
  label: "My Interviews",
  href: "/panel/interviews",
  iconName: "CalendarDays",
  roles: ["PANEL_MEMBER"],
};

export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const { logout } = useAuth();
  const { unreadCount } = useNotifications();
  const { setNotificationDrawerOpen } = useUIStore();
  const pathname = usePathname();
  const { hasInterviews } = useAssignedInterviews();
  const { coordinatorBatchId } = useAssignedCoordinator();

  if (!user) return null;

  const baseNavItems = getNavItemsForRole(user.role);

  // Inject dynamic nav items for PANEL_MEMBER / HOD based on assignments
  let navItems = baseNavItems;
  if (user.role === "PANEL_MEMBER" || user.role === "HOD") {
    const injected: NavItem[] = [];
    if (hasInterviews) {
      injected.push({ ...INTERVIEW_NAV_ITEM, roles: [user.role] });
    }
    if (coordinatorBatchId) {
      injected.push({
        label: "Demo Session",
        href: `/coordinator/${coordinatorBatchId}`,
        iconName: "QrCode",
        roles: ["PANEL_MEMBER"],
      });
    }
    if (injected.length > 0) {
      navItems = [baseNavItems[0], ...injected, ...baseNavItems.slice(1)];
    }
  }

  return (
    <aside className="hidden md:flex md:flex-col w-64 border-r bg-background min-h-screen fixed top-0 left-0 z-30">
      {/* Logo */}
      <div className="h-16 flex items-center gap-3 px-4 border-b">
        <img src="https://res.cloudinary.com/dl88qtudz/image/upload/v1781675822/vishnulogo_r2jsjl.png" alt="Vishnu Logo" className="h-9 w-9 rounded-md object-contain shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">Vishnu People</p>
          <p className="text-xs text-muted-foreground truncate">{ROLE_LABELS[user.role]}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href + "/"));
          return (
            <div key={item.href}>
              {item.section && (
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-3 pt-4 pb-1">
                  {item.section}
                </p>
              )}
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <NavIcon name={item.iconName} className="h-4 w-4 shrink-0" />
                {item.label}
                {isActive && <ChevronRight className="h-4 w-4 ml-auto shrink-0" />}
              </Link>
            </div>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="border-t p-3 space-y-1">
        <button
          onClick={() => setNotificationDrawerOpen(true)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground w-full transition-colors relative"
        >
          <Bell className="h-4 w-4 shrink-0" />
          Notifications
          {unreadCount > 0 && (
            <span className="ml-auto bg-primary text-primary-foreground text-xs rounded-full h-5 w-5 flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        <div className="flex items-center gap-3 px-3 py-2 rounded-lg">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-semibold shrink-0">
            {getInitials(user.name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            className="h-8 w-8 shrink-0"
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
