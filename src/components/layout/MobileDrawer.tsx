"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, LogOut } from "lucide-react";
import { cn, getInitials } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { useUIStore } from "@/store/uiStore";
import { useAuth } from "@/hooks/useAuth";
import { useAssignedInterviews } from "@/hooks/useAssignedInterviews";
import { useAssignedCoordinator } from "@/hooks/useAssignedCoordinator";
import { getNavItemsForRole, type NavItem } from "./navConfig";
import { NavIcon } from "./NavIcon";
import { ROLE_LABELS } from "@/types";

const INTERVIEW_NAV_ITEM: NavItem = {
  label: "My Interviews",
  href: "/panel/interviews",
  iconName: "CalendarDays",
  roles: ["PANEL_MEMBER"],
};

export function MobileDrawer() {
  const user = useAuthStore((s) => s.user);
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const { logout } = useAuth();
  const pathname = usePathname();
  const { hasInterviews } = useAssignedInterviews();
  const { coordinatorBatchId } = useAssignedCoordinator();

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname, setSidebarOpen]);

  if (!user) return null;

  const baseNavItems = getNavItemsForRole(user.role);
  let navItems = baseNavItems;
  if (user.role === "PANEL_MEMBER") {
    const injected: NavItem[] = [];
    if (hasInterviews) injected.push(INTERVIEW_NAV_ITEM);
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
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <div
        className={cn(
          "fixed top-0 left-0 z-50 h-full w-72 bg-background border-r shadow-xl transition-transform duration-300 md:hidden",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b">
          <div className="flex items-center gap-3">
            <img src="https://res.cloudinary.com/dl88qtudz/image/upload/v1781675822/vishnulogo_r2jsjl.png" alt="Vishnu Logo" className="h-9 w-9 rounded-md object-contain shrink-0" />
            <div>
              <p className="text-sm font-bold">Vishnu People</p>
              <p className="text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto h-[calc(100vh-8rem)]">
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
                    "flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <NavIcon name={item.iconName} className="h-5 w-5 shrink-0" />
                  {item.label}
                </Link>
              </div>
            );
          })}
        </nav>

        <div className="border-t p-4 absolute bottom-0 left-0 right-0">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold shrink-0">
              {getInitials(user.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.name}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full px-2 py-2 rounded-lg hover:bg-muted"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </div>
    </>
  );
}
