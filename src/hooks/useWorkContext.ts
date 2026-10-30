"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { useWorkContextStore } from "@/store/workContextStore";
import {
  getCollegeAdminNavItems, getNavItemsForContext, getWorkContexts, resolveWorkContext,
  type NavItem, type WorkContext, type WorkContextKey,
} from "@/components/layout/navConfig";
import { isCollegeAdminRole } from "@/lib/auth/collegeAdminPaths";
import { ACTIVE_HOD_DEPT_COOKIE, departmentOfContext, encodeActiveHodDepartment } from "@/lib/roles/activeHodDepartment";

// Tells the server which department a multi-department HOD is working in (see
// lib/roles/activeHodDepartment.ts). Cleared in every other context.
export function syncActiveHodCookie(uid: string, active: string | null | undefined) {
  if (typeof document === "undefined") return;
  const dept = departmentOfContext(active);
  document.cookie = dept
    ? `${ACTIVE_HOD_DEPT_COOKIE}=${encodeActiveHodDepartment(uid, dept)}; path=/; max-age=31536000; SameSite=Lax`
    : `${ACTIVE_HOD_DEPT_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

// What the sidebar / drawer show for the signed-in login: the items of the
// context it is working as, plus the contexts it can switch between (empty when
// it holds no seats).
export function useWorkContext(): { items: NavItem[]; contexts: WorkContext[]; active: WorkContextKey | null } {
  const user = useAuthStore((s) => s.user);
  const chosen = useWorkContextStore((s) => (user ? s.chosen[user.uid] : undefined));
  const pathname = usePathname();
  const uid = user?.uid;
  const roles = user?.roles ?? user?.seatRoles ?? [];
  const hodDepartments = user?.departments ?? (user?.department ? [user.department] : []);
  // A College Admin is one role-login with one dashboard: no "My Work", no seat dropdown (no contexts at
  // all, so the switcher is not drawn). The menu is always the admin's own (no HOD department, no seat
  // context), so every page it manages is in that one place.
  const collegeAdmin = isCollegeAdminRole(user?.realRole);
  const active = user ? (collegeAdmin ? "ME" as WorkContextKey : resolveWorkContext(user.role, roles, chosen, pathname, hodDepartments)) : null;

  useEffect(() => {
    if (uid) syncActiveHodCookie(uid, active);
  }, [uid, active]);

  if (!user) return { items: [], contexts: [], active: null };
  if (collegeAdmin) return { items: getCollegeAdminNavItems(), contexts: [], active };
  return {
    items: getNavItemsForContext(user.role, roles, active ?? "ME"),
    contexts: getWorkContexts(user.role, roles, hodDepartments),
    active,
  };
}
