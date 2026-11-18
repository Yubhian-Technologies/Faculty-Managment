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
  // A College Admin always holds every department's HOD seat and the office roles (lib/roles/collegeAdminPowers.ts):
  // the "Working as" switcher offers "College Admin" (its own menu) plus each of them.
  const takenOver = collegeAdmin && user ? roles.filter((r) => r !== user.role && r !== "COLLEGE_OFFICE" && r !== "PRINCIPAL") : [];
  const switchable = !collegeAdmin || takenOver.length > 0;
  const active = user ? (!switchable ? "ME" as WorkContextKey : resolveWorkContext(user.role, collegeAdmin ? takenOver : roles, chosen, pathname, hodDepartments)) : null;

  useEffect(() => {
    if (uid) syncActiveHodCookie(uid, active);
  }, [uid, active]);

  if (!user) return { items: [], contexts: [], active: null };
  if (collegeAdmin && !switchable) return { items: getCollegeAdminNavItems(), contexts: [], active };
  if (collegeAdmin) {
    return {
      items: active === "ME" ? getCollegeAdminNavItems() : getNavItemsForContext(user.role, takenOver, active ?? "ME"),
      contexts: getWorkContexts(user.role, takenOver, hodDepartments).map((c) => (c.key === "ME" ? { ...c, label: "College Admin" } : c)),
      active,
    };
  }
  return {
    items: getNavItemsForContext(user.role, roles, active ?? "ME"),
    contexts: getWorkContexts(user.role, roles, hodDepartments),
    active,
  };
}
