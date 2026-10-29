"use client";

import { CollegeLogo } from "@/components/shared/CollegeLogo";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut, ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { useUIStore } from "@/store/uiStore";
import { useAuth } from "@/hooks/useAuth";
import { useAssignedInterviews } from "@/hooks/useAssignedInterviews";
import { useAssignedCoordinator } from "@/hooks/useAssignedCoordinator";
import { useIsSubDepartmentHod } from "@/hooks/useIsSubDepartmentHod";
import { usePrincipalPendingHiring } from "@/hooks/usePrincipalPendingHiring";
import { useCollegeType } from "@/hooks/useCollegeType";
import { INCIDENT_RECORD_HREFS, useIncidentUnread } from "@/hooks/useIncidentUnread";
import { hasSupportingStaffSplit } from "@/lib/designations/config";
import { isNavItemActive, filterVisibleNavItems, isPathHidden, ROLES_WITH_EMBEDDED_PANEL_ACCESS, type NavItem } from "./navConfig";
import { NavIcon } from "./NavIcon";
import { groupNavItems } from "./navGroups";
import { useCustomNav } from "@/hooks/useCustomNav";
import { WorkContextSwitcher } from "./WorkContextSwitcher";
import { readOnlyNavItems } from "./readOnlyNav";
import { LocationDeptSwitcher } from "./LocationDeptSwitcher";
import { useWorkContext } from "@/hooks/useWorkContext";
import { OrgScopeTree } from "./OrgScopeTree";
import { ROLE_LABELS } from "@/types";
import { getInitials } from "@/lib/utils";
import { UserCardSubtitle } from "./UserCardSubtitle";
import { Button } from "@/components/ui/button";

const INTERVIEW_NAV_ITEM: NavItem = {
  label: "My Interviews",
  href: "/panel/interviews",
  iconName: "CalendarDays",
  roles: ["PANEL_MEMBER"],
};

// Panel Scoring and Appointment Letters were folded into this tab (see
// navConfig.ts) - the red badge is the only remaining signal that something
// across the whole pipeline (including those two stages) needs the
// Principal/Vice Principal's attention.
const PENDING_HIRING_HREF = "/principal/vacancies";

interface SidebarProps {
  hiddenModules: string[];
  hiddenItems: string[];
}

export function Sidebar({ hiddenModules, hiddenItems }: SidebarProps) {
  const user = useAuthStore((s) => s.user);
  const { logout } = useAuth();
  const pathname = usePathname();
  const { hasInterviews } = useAssignedInterviews();
  const { coordinatorBatchId } = useAssignedCoordinator();
  const { hideSubDepartmentsLink } = useIsSubDepartmentHod();
  const { pendingCount: pendingHiringCount } = usePrincipalPendingHiring();
  const incidentUnread = useIncidentUnread();
  const { collegeType } = useCollegeType();
  const { items: contextItems, active: activeContext } = useWorkContext();
  const { apply: applyCustomNav } = useCustomNav();
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const setCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  // Groups the user folded shut (keyed by section title). The group holding the open page is never folded.
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());

  if (!user) return null;

  // "Sub-Departments" is hidden unless the HOD's own department both isn't
  // itself a sub-department and has sub-departments enabled by the Principal
  // - see useIsSubDepartmentHod for why either gap makes the page a dead end.
  // "Designations" is hidden for college types with no Technical/Non-
  // Technical split (School) - HOD has nothing to manage there, it's all
  // centrally owned by Principal (see hasSupportingStaffSplit).
  const baseNavItems = filterVisibleNavItems(contextItems, hiddenModules, hiddenItems, user.realRole, true)
    .filter((item) => !hideSubDepartmentsLink || item.href !== "/hod/settings/sub-departments")
    .filter((item) => hasSupportingStaffSplit(collegeType) || item.href !== "/hod/settings/designations");

  // Inject dynamic nav items based on panel assignments (any role can be a panel member)
  let navItems = baseNavItems;
  {
    // "My Interviews" and "Demo Session" belong to the person, not to a seat: they are offered only
    // in the context they can actually be opened from. Injecting them into a seat's context (Principal,
    // HOD...) showed them twice, and opening one bounced to "My Work" because that context owns the page.
    // (Panel scoring is reached from the seat's own pipeline board, and from My Work.)
    const inSeatContext = !!activeContext && activeContext !== "ME";
    const injected: NavItem[] = [];
    // Skip roles that already have a static "Panel Scoring" tab in navConfig
    // (PANEL_MEMBER included — their static list has no such tab, so this
    // dynamic injection is the only way they ever get one; matches MobileDrawer).
    const isInterviewHidden = isPathHidden(INTERVIEW_NAV_ITEM.href, user.role, hiddenModules, hiddenItems);
    if (
      hasInterviews &&
      !isInterviewHidden &&
      !inSeatContext &&
      !ROLES_WITH_EMBEDDED_PANEL_ACCESS.has(user.role) &&
      !baseNavItems.some((i) => i.href === INTERVIEW_NAV_ITEM.href)
    ) {
      injected.push({ ...INTERVIEW_NAV_ITEM, roles: [user.role] });
    }
    if (coordinatorBatchId && !inSeatContext) {
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

  // Super-Admin-built tabs and tab order for this college (no-op when none).
  navItems = applyCustomNav(navItems, hiddenItems);
  // RESIGNED/RETIRED: a fixed, view-only menu (see readOnlyNavItems) instead of the normal one.
  if (user.readOnlyAccess) navItems = readOnlyNavItems();

  // A nav item that starts a `section` opens a new group; the items after it belong to it.
  const groups = groupNavItems(navItems);
  const toggleGroup = (title: string) =>
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title); else next.add(title);
      return next;
    });

  return (
    <aside
      className={cn(
        "hidden md:flex md:flex-col border-r bg-background h-screen fixed top-0 left-0 z-30",
        "transition-[width] duration-300 ease-in-out",
        collapsed ? "w-[4.5rem]" : "w-64"
      )}
    >
      {/* Collapse / expand handle, sitting on the sidebar's edge */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-5 z-40 h-6 w-6 rounded-full border bg-background text-muted-foreground shadow-sm flex items-center justify-center hover:text-foreground hover:bg-muted transition-colors"
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
      </button>

      {/* Logo */}
      <div className={cn("h-16 flex items-center gap-3 border-b shrink-0 overflow-hidden", collapsed ? "justify-center px-0" : "px-4")}>
        <CollegeLogo className="h-9 w-9 rounded-md object-contain shrink-0" />
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate">Vishnu People</p>
            <p className="text-xs text-muted-foreground truncate">{ROLE_LABELS[user.realRole ?? user.role]}</p>
          </div>
        )}
      </div>

      <WorkContextSwitcher compact={collapsed} />
      <LocationDeptSwitcher compact={collapsed} />

      {/* Navigation */}
      <nav className={cn("flex-1 py-3 overflow-y-auto overflow-x-hidden", collapsed ? "px-2" : "px-3")}>
        {groups.map((group, gi) => {
          const hasActive = group.items.some((item) => isNavItemActive(item, pathname, navItems));
          // A folded group still shows its open page; on the icon rail every group is open.
          const open = collapsed || !group.title || !closedGroups.has(group.title) || hasActive;
          return (
            <div key={`${group.title ?? "top"}-${gi}`} className={cn(gi > 0 && (collapsed ? "mt-2 pt-2 border-t" : "mt-3"))}>
              {group.title && !collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.title as string)}
                  aria-expanded={open}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest hover:text-foreground transition-colors"
                >
                  <span className="truncate">{group.title}</span>
                  <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200", !open && "-rotate-90")} />
                </button>
              )}
              <div className={cn("grid transition-[grid-template-rows] duration-200 ease-in-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                <div className="overflow-hidden">
                  <div className="space-y-1 py-0.5">
                    {group.items.map((item) => {
                      const isActive = isNavItemActive(item, pathname, navItems);
                      const showBadge = item.href === PENDING_HIRING_HREF && pendingHiringCount > 0;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          title={collapsed ? item.label : undefined}
                          aria-label={collapsed ? item.label : undefined}
                          className={cn(
                            "relative flex items-center rounded-lg text-sm font-medium transition-all duration-200",
                            collapsed ? "justify-center h-10 w-full" : "gap-3 px-3 py-2.5",
                            isActive
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : cn("text-muted-foreground hover:bg-muted hover:text-foreground", !collapsed && "hover:translate-x-0.5")
                          )}
                        >
                          <NavIcon name={item.iconName} className="h-4 w-4 shrink-0" />
                          {!collapsed && <span className="truncate">{item.label}</span>}
                          {showBadge && (collapsed ? (
                            <span className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-red-500" />
                          ) : (
                            <span className="ml-auto bg-red-500 text-white text-xs rounded-full h-5 min-w-5 px-1 flex items-center justify-center font-semibold">
                              {pendingHiringCount > 99 ? "99+" : pendingHiringCount}
                            </span>
                          ))}
                          {incidentUnread > 0 && INCIDENT_RECORD_HREFS.includes(item.href) && (
                            <span
                              className={cn("h-2.5 w-2.5 rounded-full bg-red-500", collapsed ? "absolute top-1 right-1" : "ml-auto")}
                              role="img"
                              aria-label="New incident records"
                            />
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {!collapsed && user.role === "FINANCE" && (
          <div className="border-t mt-2 pt-2">
            <OrgScopeTree
              collegeHref={(locationId, collegeId) => `/finance/browse/${locationId}/${collegeId}`}
              departmentHref={(locationId, collegeId, department) => `/finance/browse/${locationId}/${collegeId}?department=${encodeURIComponent(department)}`}
            />
          </div>
        )}

        {!collapsed && user.role === "PURCHASE_DEPT" && (
          <div className="border-t mt-2 pt-2">
            <OrgScopeTree
              collegeHref={(locationId, collegeId) => `/purchase/browse/${locationId}/${collegeId}`}
              departmentHref={(_locationId, collegeId, department) => `/purchase/indents?collegeId=${collegeId}&department=${encodeURIComponent(department)}`}
            />
          </div>
        )}
      </nav>

      {/* Bottom section */}
      <div className="border-t p-3 shrink-0">
        <div className={cn("flex items-center rounded-lg", collapsed ? "flex-col gap-2 py-1" : "gap-3 px-3 py-2")}>
          <div
            className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-semibold shrink-0 overflow-hidden"
            title={collapsed ? user.name : undefined}
          >
            {user.profilePhotoUrl ? (
              <img src={user.profilePhotoUrl} alt={user.name} className="h-full w-full object-cover" />
            ) : (
              getInitials(user.name)
            )}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.name}</p>
              <UserCardSubtitle user={user} />
            </div>
          )}
          <Button variant="ghost" size="icon" onClick={logout} className="h-8 w-8 shrink-0" title="Log out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
