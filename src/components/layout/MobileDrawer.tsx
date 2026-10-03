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
import { useIsSubDepartmentHod } from "@/hooks/useIsSubDepartmentHod";
import { usePrincipalPendingHiring } from "@/hooks/usePrincipalPendingHiring";
import { isNavItemActive, filterVisibleNavItems, isPathHidden, ROLES_WITH_EMBEDDED_PANEL_ACCESS, type NavItem } from "./navConfig";
import { NavIcon } from "./NavIcon";
import { WorkContextSwitcher } from "./WorkContextSwitcher";
import { LocationDeptSwitcher } from "./LocationDeptSwitcher";
import { useWorkContext } from "@/hooks/useWorkContext";
import { ROLE_LABELS } from "@/types";

const INTERVIEW_NAV_ITEM: NavItem = {
  label: "My Interviews",
  href: "/panel/interviews",
  iconName: "CalendarDays",
  roles: ["PANEL_MEMBER"],
};

// See Sidebar.tsx - same badge, mirrored here for the mobile drawer.
const PENDING_HIRING_HREF = "/principal/vacancies";

interface MobileDrawerProps {
  hiddenModules: string[];
  hiddenItems: string[];
}

export function MobileDrawer({ hiddenModules, hiddenItems }: MobileDrawerProps) {
  const user = useAuthStore((s) => s.user);
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const { logout } = useAuth();
  const pathname = usePathname();
  const { hasInterviews } = useAssignedInterviews();
  const { coordinatorBatchId } = useAssignedCoordinator();
  const { hideSubDepartmentsLink } = useIsSubDepartmentHod();
  const { pendingCount: pendingHiringCount } = usePrincipalPendingHiring();
  const { items: contextItems } = useWorkContext();

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname, setSidebarOpen]);

  // While the drawer is open: lock background scroll and let Escape close it.
  useEffect(() => {
    if (!sidebarOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [sidebarOpen, setSidebarOpen]);

  if (!user || user.role === "CLASS_LEADER" || pathname?.startsWith("/class-leader")) return null;

  const baseNavItems = filterVisibleNavItems(contextItems, hiddenModules, hiddenItems, user.realRole, true)
    .filter((item) => !hideSubDepartmentsLink || item.href !== "/hod/settings/sub-departments");
  let navItems = baseNavItems;
  {
    const injected: NavItem[] = [];
    // Skip roles that already have a static "Panel Scoring" tab in navConfig,
    // and roles whose own hiring-pipeline board already links into panel scoring.
    const isInterviewHidden = isPathHidden(INTERVIEW_NAV_ITEM.href, user.role, hiddenModules, hiddenItems);
    if (
      hasInterviews &&
      !isInterviewHidden &&
      !ROLES_WITH_EMBEDDED_PANEL_ACCESS.has(user.role) &&
      !baseNavItems.some((i) => i.href === INTERVIEW_NAV_ITEM.href)
    ) {
      injected.push({ ...INTERVIEW_NAV_ITEM, roles: [user.role] });
    }
    if (coordinatorBatchId) {
      injected.push({
        label: "Demo Session",
        href: `/coordinator/${coordinatorBatchId}`,
        iconName: "QrCode",
        roles: [user.role],
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
          aria-hidden="true"
        />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        aria-hidden={!sidebarOpen}
        className={cn(
          "fixed top-0 left-0 z-50 flex h-dvh w-[85vw] max-w-72 flex-col bg-background border-r shadow-xl transition-transform duration-300 md:hidden",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b shrink-0">
          <div className="flex items-center gap-3">
            <img src="https://res.cloudinary.com/dl88qtudz/image/upload/v1781675822/vishnulogo_r2jsjl.png" alt="Vishnu Logo" className="h-9 w-9 rounded-md object-contain shrink-0" />
            <div>
              <p className="text-sm font-bold">Vishnu People</p>
              <p className="text-xs text-muted-foreground">{ROLE_LABELS[user.realRole ?? user.role]}</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
            className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <WorkContextSwitcher />
        <LocationDeptSwitcher />

        <nav className="flex-1 min-h-0 px-3 py-4 space-y-1 overflow-y-auto overscroll-contain">
          {navItems.map((item) => {
            const isActive = isNavItemActive(item, pathname, navItems);
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
                  {item.href === PENDING_HIRING_HREF && pendingHiringCount > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-xs rounded-full h-5 min-w-5 px-1 flex items-center justify-center font-semibold">
                      {pendingHiringCount > 99 ? "99+" : pendingHiringCount}
                    </span>
                  )}
                </Link>
              </div>
            );
          })}
        </nav>

        <div className="border-t px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shrink-0">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold shrink-0 overflow-hidden">
              {user.profilePhotoUrl ? (
                <img src={user.profilePhotoUrl} alt={user.name} className="h-full w-full object-cover" />
              ) : (
                getInitials(user.name)
              )}
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
