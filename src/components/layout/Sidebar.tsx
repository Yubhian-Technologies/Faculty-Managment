"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { useAuth } from "@/hooks/useAuth";
import { useAssignedInterviews } from "@/hooks/useAssignedInterviews";
import { useAssignedCoordinator } from "@/hooks/useAssignedCoordinator";
import { useIsSubDepartmentHod } from "@/hooks/useIsSubDepartmentHod";
import { usePrincipalPendingHiring } from "@/hooks/usePrincipalPendingHiring";
import { useCollegeType } from "@/hooks/useCollegeType";
import { hasSupportingStaffSplit } from "@/lib/designations/config";
import { isNavItemActive, filterVisibleNavItems, isPathHidden, ROLES_WITH_EMBEDDED_PANEL_ACCESS, type NavItem } from "./navConfig";
import { useIsTimetableIncharge } from "@/hooks/useIsTimetableIncharge";
import { useCanSendCirculars } from "@/hooks/useCanSendCirculars";
import { NavIcon } from "./NavIcon";
import { WorkContextSwitcher } from "./WorkContextSwitcher";
import { useWorkContext } from "@/hooks/useWorkContext";
import { OrgScopeTree } from "./OrgScopeTree";
import { ROLE_LABELS } from "@/types";
import { getInitials } from "@/lib/utils";
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
  const { collegeType } = useCollegeType();
  const { items: contextItems } = useWorkContext();
  const { isIncharge } = useIsTimetableIncharge();
  // Circulars tab is assignment-gated: only Principal/VP and users the Principal
  // granted send-permission see it (server is still the real gate - see
  // useCanSendCirculars). null = still resolving; keep the tab visible while
  // loading to avoid flicker for users who do have access.
  const { canSend: canSendCirculars } = useCanSendCirculars();

  if (!user) return null;

  // "Sub-Departments" is hidden unless the HOD's own department both isn't
  // itself a sub-department and has sub-departments enabled by the Principal
  // - see useIsSubDepartmentHod for why either gap makes the page a dead end.
  // "Supporting Staff" is hidden for college types with no Technical/Non-
  // Technical split (School) - HOD has nothing to manage there, it's all
  // centrally owned by Principal (see hasSupportingStaffSplit).
  const baseNavItems = filterVisibleNavItems(contextItems, hiddenModules, hiddenItems, user.realRole, true)
    .filter((item) => !hideSubDepartmentsLink || item.href !== "/hod/settings/sub-departments")
    .filter((item) => hasSupportingStaffSplit(collegeType) || (item.href !== "/hod/supporting-staff" && item.href !== "/hod/settings/designations"))
    .filter((item) => {
      // Circulars is delegated — hide the nav entry when the user holds no
      // send-permission (Principal/VP or circularPermissions grant). HOD/Panel
      // users without the grant never see the tab; Principal/VP are unaffected.
      const isCircularsNav = item.href === "/hod/circulars" || item.href === "/panel/circulars";
      if (isCircularsNav) return canSendCirculars !== false;
      return true;
    })
    .filter((item) => {
      // Timetable Incharge is delegated — hide the nav entry when the user holds
      // no such delegation (checked once on mount via useIsTimetableIncharge).
      // HOD/PRINCIPAL etc. never use this href, so they are unaffected.
      const isInchargeNav = item.href === "/panel/timetable-incharge" || item.href === "/college-staff/timetable-incharge";
      if (!isInchargeNav) return true;
      // While loading, keep visible to avoid flicker; once resolved, hide if not incharge.
      if (isIncharge === null) return true;
      return isIncharge === true;
    });

  // Inject dynamic nav items based on panel assignments (any role can be a panel member)
  let navItems = baseNavItems;
  {
    const injected: NavItem[] = [];
    // Skip roles that already have a static "Panel Scoring" tab in navConfig
    // (PANEL_MEMBER included — their static list has no such tab, so this
    // dynamic injection is the only way they ever get one; matches MobileDrawer).
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
    <aside className="hidden md:flex md:flex-col w-64 border-r bg-background h-screen fixed top-0 left-0 z-30">
      {/* Logo */}
      <div className="h-16 flex items-center gap-3 px-4 border-b shrink-0">
        <img src="https://res.cloudinary.com/dl88qtudz/image/upload/v1781675822/vishnulogo_r2jsjl.png" alt="Vishnu Logo" className="h-9 w-9 rounded-md object-contain shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">Vishnu People</p>
          <p className="text-xs text-muted-foreground truncate">{ROLE_LABELS[user.realRole ?? user.role]}</p>
        </div>
      </div>

      <WorkContextSwitcher />

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
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
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <NavIcon name={item.iconName} className="h-4 w-4 shrink-0" />
                {item.label}
                {item.href === PENDING_HIRING_HREF && pendingHiringCount > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-xs rounded-full h-5 min-w-5 px-1 flex items-center justify-center font-semibold">
                    {pendingHiringCount > 99 ? "99+" : pendingHiringCount}
                  </span>
                )}
                {isActive && <ChevronRight className="h-4 w-4 ml-auto shrink-0" />}
              </Link>
            </div>
          );
        })}

        {user.role === "FINANCE" && (
          <div className="border-t mt-2 pt-2">
            <OrgScopeTree
              collegeHref={(locationId, collegeId) => `/finance/browse/${locationId}/${collegeId}`}
              departmentHref={(locationId, collegeId, department) => `/finance/browse/${locationId}/${collegeId}?department=${encodeURIComponent(department)}`}
            />
          </div>
        )}

        {user.role === "PURCHASE_DEPT" && (
          <div className="border-t mt-2 pt-2">
            <OrgScopeTree
              collegeHref={(locationId, collegeId) => `/purchase/browse/${locationId}/${collegeId}`}
              departmentHref={(_locationId, collegeId, department) => `/purchase/indents?collegeId=${collegeId}&department=${encodeURIComponent(department)}`}
            />
          </div>
        )}
      </nav>

      {/* Bottom section */}
      <div className="border-t p-3 space-y-1 shrink-0">
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-semibold shrink-0 overflow-hidden">
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
