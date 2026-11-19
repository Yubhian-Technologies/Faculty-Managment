"use client";

import { useNavLabels } from "@/hooks/useNavLabels";
import { groupNavItems } from "./navGroups";
import { CollegeLogo } from "@/components/shared/CollegeLogo";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { X, LogOut } from "lucide-react";
import { cn, getInitials } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { useUIStore } from "@/store/uiStore";
import { useAuth } from "@/hooks/useAuth";
import { useFacultyDisplayNames } from "@/hooks/useFacultyDisplayNames";
import { useAssignedInterviews } from "@/hooks/useAssignedInterviews";
import { useAssignedCoordinator } from "@/hooks/useAssignedCoordinator";
import { useIsSubDepartmentHod } from "@/hooks/useIsSubDepartmentHod";
import { usePrincipalPendingHiring } from "@/hooks/usePrincipalPendingHiring";
import { INCIDENT_RECORD_HREFS, useIncidentUnread } from "@/hooks/useIncidentUnread";
import { filterVisibleNavItems, isPathHidden, ROLES_WITH_EMBEDDED_PANEL_ACCESS, type NavItem } from "./navConfig";
import { NavMenu } from "./NavMenu";
import { UserCardSubtitle } from "./UserCardSubtitle";
import { NavFinder } from "./NavFinder";
import { NAV_MUTED, NAV_SURFACE } from "./navTheme";
import { useCollegeInfo } from "@/hooks/useCollegeInfo";
import { useCustomNav } from "@/hooks/useCustomNav";
import { WorkContextSwitcher } from "./WorkContextSwitcher";
import { readOnlyNavItems } from "./readOnlyNav";
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
  const { nameFor } = useFacultyDisplayNames();
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const { logout } = useAuth();
  const pathname = usePathname();
  const navLabel = useNavLabels();
  const { hasInterviews } = useAssignedInterviews();
  const { coordinatorBatchId } = useAssignedCoordinator();
  const { hideSubDepartmentsLink } = useIsSubDepartmentHod();
  const { pendingCount: pendingHiringCount } = usePrincipalPendingHiring();
  const incidentUnread = useIncidentUnread();
  const { items: contextItems, active: activeContext, contexts } = useWorkContext();
  const { collegeInfo } = useCollegeInfo();
  const { apply: applyCustomNav } = useCustomNav();

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
  const shownName = nameFor("dashboardName", { uid: user.uid }, user.name);

  const baseNavItems = filterVisibleNavItems(contextItems, hiddenModules, hiddenItems, user.realRole, true)
    .filter((item) => !hideSubDepartmentsLink || item.href !== "/hod/settings/sub-departments");
  let navItems = baseNavItems;
  {
    // "My Interviews" and "Demo Session" belong to the person, not to a seat: they are offered only
    // in the context they can actually be opened from. Injecting them into a seat's context (Principal,
    // HOD...) showed them twice, and opening one bounced to "My Work" because that context owns the page.
    // (Panel scoring is reached from the seat's own pipeline board, and from My Work.)
    const inSeatContext = !!activeContext && activeContext !== "ME";
    const injected: NavItem[] = [];
    // Skip roles that already have a static "Panel Scoring" tab in navConfig,
    // and roles whose own hiring-pipeline board already links into panel scoring.
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
  const workingAs = contexts.find((c) => c.key === activeContext)?.label ?? ROLE_LABELS[user.realRole ?? user.role];
  const subtitle = [collegeInfo?.code, workingAs].filter(Boolean).join(" · ");
  const close = () => setSidebarOpen(false);
  const badge = (item: NavItem) => {
    if (item.href === PENDING_HIRING_HREF && pendingHiringCount > 0) {
      return <span className="ml-auto bg-red-500 text-white text-[11px] rounded-full h-5 min-w-5 px-1.5 flex items-center justify-center font-bold">{pendingHiringCount > 99 ? "99+" : pendingHiringCount}</span>;
    }
    if (incidentUnread > 0 && INCIDENT_RECORD_HREFS.includes(item.href)) {
      return <span className="ml-auto h-2.5 w-2.5 rounded-full bg-red-500" role="img" aria-label="New incident records" />;
    }
    return null;
  };

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-50 bg-black/60 md:hidden transition-opacity duration-300",
          sidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        // inert (not aria-hidden): a closed drawer also gives up focus, so the browser never hides a focused link.
        inert={!sidebarOpen}
        className={cn(
          cn("fixed top-0 left-0 z-50 flex h-dvh w-[85vw] max-w-72 flex-col border-r shadow-xl transition-transform duration-300 md:hidden", NAV_SURFACE),
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between h-16 px-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <CollegeLogo className="h-9 w-9 rounded-lg bg-white p-0.5 object-contain shrink-0" />
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-white truncate">Vishnu People</p>
              <p className={cn("text-xs truncate", NAV_MUTED)}>{subtitle}</p>
            </div>
          </div>
          <button
            onClick={close}
            aria-label="Close menu"
            className="h-9 w-9 flex items-center justify-center rounded-lg text-[#c9d3ee] hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <WorkContextSwitcher />
        <LocationDeptSwitcher />

        <div className="pt-2.5 shrink-0">
          <NavFinder groups={groups} label={navLabel} onNavigate={close} />
        </div>

        <nav className="flex-1 min-h-0 px-2.5 py-2 overflow-y-auto overscroll-contain">
          <NavMenu groups={groups} navItems={navItems} pathname={pathname ?? ""} label={navLabel} roomy badge={badge} />
        </nav>

        <div className="border-t border-white/10 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-amber-400 to-rose-500 flex items-center justify-center text-white font-bold shrink-0 overflow-hidden">
              {user.profilePhotoUrl ? (
                <img src={user.profilePhotoUrl} alt={shownName} className="h-full w-full object-cover" />
              ) : (
                getInitials(shownName)
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{shownName}</p>
              {user.role === "STUDENT" ? <UserCardSubtitle user={user} className={cn("text-xs truncate", NAV_MUTED)} /> : <p className={cn("text-xs truncate", NAV_MUTED)}>{workingAs}</p>}
            </div>
            <button
              onClick={logout}
              aria-label="Log Out"
              title="Log Out"
              className={cn("h-10 w-10 flex items-center justify-center rounded-lg hover:bg-white/10 hover:text-white", NAV_MUTED)}
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
