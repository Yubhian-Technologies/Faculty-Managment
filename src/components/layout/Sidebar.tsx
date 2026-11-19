"use client";

import { useNavLabels } from "@/hooks/useNavLabels";
import { CollegeLogo } from "@/components/shared/CollegeLogo";
import { usePathname } from "next/navigation";
import { LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { useUIStore } from "@/store/uiStore";
import { useAuth } from "@/hooks/useAuth";
import { useFacultyDisplayNames } from "@/hooks/useFacultyDisplayNames";
import { useAssignedInterviews } from "@/hooks/useAssignedInterviews";
import { useAssignedCoordinator } from "@/hooks/useAssignedCoordinator";
import { useIsSubDepartmentHod } from "@/hooks/useIsSubDepartmentHod";
import { usePrincipalPendingHiring } from "@/hooks/usePrincipalPendingHiring";
import { useCollegeType } from "@/hooks/useCollegeType";
import { INCIDENT_RECORD_HREFS, useIncidentUnread } from "@/hooks/useIncidentUnread";
import { hasSupportingStaffSplit } from "@/lib/designations/config";
import { filterVisibleNavItems, isPathHidden, ROLES_WITH_EMBEDDED_PANEL_ACCESS, type NavItem } from "./navConfig";
import { NavMenu } from "./NavMenu";
import { UserCardSubtitle } from "./UserCardSubtitle";
import { NavFinder } from "./NavFinder";
import { NAV_MUTED, NAV_SURFACE } from "./navTheme";
import { useCollegeInfo } from "@/hooks/useCollegeInfo";
import { groupNavItems } from "./navGroups";
import { useCustomNav } from "@/hooks/useCustomNav";
import { WorkContextSwitcher } from "./WorkContextSwitcher";
import { readOnlyNavItems } from "./readOnlyNav";
import { LocationDeptSwitcher } from "./LocationDeptSwitcher";
import { useWorkContext } from "@/hooks/useWorkContext";
import { OrgScopeTree } from "./OrgScopeTree";
import { ROLE_LABELS } from "@/types";
import { getInitials } from "@/lib/utils";

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
  const { nameFor } = useFacultyDisplayNames();
  const { logout } = useAuth();
  const pathname = usePathname();
  const navLabel = useNavLabels();
  const { hasInterviews } = useAssignedInterviews();
  const { coordinatorBatchId } = useAssignedCoordinator();
  const { hideSubDepartmentsLink } = useIsSubDepartmentHod();
  const { pendingCount: pendingHiringCount } = usePrincipalPendingHiring();
  const incidentUnread = useIncidentUnread();
  const { collegeType } = useCollegeType();
  const { items: contextItems, active: activeContext, contexts } = useWorkContext();
  const { collegeInfo } = useCollegeInfo();
  const { apply: applyCustomNav } = useCustomNav();
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const setCollapsed = useUIStore((s) => s.setSidebarCollapsed);

  if (!user) return null;
  const shownName = nameFor("dashboardName", { uid: user.uid }, user.name);

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
  // Header line: the college's code and the role being worked as ("VIT · Principal").
  const workingAs = contexts.find((c) => c.key === activeContext)?.label ?? ROLE_LABELS[user.realRole ?? user.role];
  const subtitle = [collegeInfo?.code, workingAs].filter(Boolean).join(" · ");
  const badge = (item: NavItem, rail: boolean) => {
    if (item.href === PENDING_HIRING_HREF && pendingHiringCount > 0) {
      return rail
        ? <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-[#14224d]" />
        : <span className="ml-auto bg-red-500 text-white text-[11px] rounded-full h-5 min-w-5 px-1.5 flex items-center justify-center font-bold">{pendingHiringCount > 99 ? "99+" : pendingHiringCount}</span>;
    }
    if (incidentUnread > 0 && INCIDENT_RECORD_HREFS.includes(item.href)) {
      return <span className={cn("h-2 w-2 rounded-full bg-red-500", rail ? "absolute top-1.5 right-1.5 ring-2 ring-[#14224d]" : "ml-auto")} role="img" aria-label="New incident records" />;
    }
    return null;
  };

  return (
    <aside
      className={cn(
        "hidden md:flex md:flex-col border-r h-screen fixed top-0 left-0 z-30",
        NAV_SURFACE,
        "transition-[width] duration-300 ease-in-out",
        collapsed ? "w-[4.5rem]" : "w-64"
      )}
    >
      {/* Logo */}
      <div className={cn("h-16 flex items-center gap-3 shrink-0 overflow-hidden", collapsed ? "justify-center px-0" : "px-4")}>
        <CollegeLogo className="h-9 w-9 rounded-lg bg-white p-0.5 object-contain shrink-0" />
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-white truncate">Vishnu People</p>
            <p className={cn("text-xs truncate", NAV_MUTED)}>{subtitle}</p>
          </div>
        )}
      </div>

      <WorkContextSwitcher compact={collapsed} />
      <LocationDeptSwitcher compact={collapsed} />
      <div className={cn("pt-2.5 shrink-0", collapsed && "px-2")}>
        <NavFinder groups={groups} label={navLabel} compact={collapsed} hotkey />
      </div>

      {/* Navigation */}
      <nav className={cn("flex-1 py-2 overflow-y-auto overflow-x-hidden [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.15)_transparent]", collapsed ? "px-2" : "px-2.5")}>
        <NavMenu groups={groups} navItems={navItems} pathname={pathname} label={navLabel} collapsed={collapsed} badge={badge} />

        {!collapsed && user.role === "FINANCE" && (
          <div className="border-t border-white/10 mt-2 pt-2">
            <OrgScopeTree
              collegeHref={(locationId, collegeId) => `/finance/browse/${locationId}/${collegeId}`}
              departmentHref={(locationId, collegeId, department) => `/finance/browse/${locationId}/${collegeId}?department=${encodeURIComponent(department)}`}
            />
          </div>
        )}

        {!collapsed && user.role === "PURCHASE_DEPT" && (
          <div className="border-t border-white/10 mt-2 pt-2">
            <OrgScopeTree
              collegeHref={(locationId, collegeId) => `/purchase/browse/${locationId}/${collegeId}`}
              departmentHref={(_locationId, collegeId, department) => `/purchase/indents?collegeId=${collegeId}&department=${encodeURIComponent(department)}`}
            />
          </div>
        )}
      </nav>

      {/* Bottom section */}
      <div className="border-t border-white/10 px-2.5 py-2.5 shrink-0">
        <div className={cn("flex items-center", collapsed ? "flex-col gap-1.5" : "gap-2.5 px-1")}>
          <div
            className="h-9 w-9 rounded-full bg-gradient-to-br from-amber-400 to-rose-500 flex items-center justify-center text-white text-[13px] font-bold shrink-0 overflow-hidden"
            title={collapsed ? shownName : undefined}
          >
            {user.profilePhotoUrl ? (
              <img src={user.profilePhotoUrl} alt={shownName} className="h-full w-full object-cover" />
            ) : (
              getInitials(shownName)
            )}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-white truncate" title={shownName}>{shownName}</p>
              {user.role === "STUDENT" ? <UserCardSubtitle user={user} className={cn("text-[11.5px] truncate", NAV_MUTED)} /> : <p className={cn("text-[11.5px] truncate", NAV_MUTED)}>{workingAs}</p>}
            </div>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className={cn("h-8 w-8 shrink-0 rounded-lg flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors", NAV_MUTED)}
            title={collapsed ? "Expand Menu" : "Collapse Menu"}
            aria-label={collapsed ? "Expand Menu" : "Collapse Menu"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={logout}
            className={cn("h-8 w-8 shrink-0 rounded-lg flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors", NAV_MUTED)}
            title="Log Out"
            aria-label="Log Out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
