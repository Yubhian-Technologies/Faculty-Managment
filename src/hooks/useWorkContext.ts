"use client";

import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { useWorkContextStore } from "@/store/workContextStore";
import {
  getNavItemsForContext, getWorkContexts, resolveWorkContext,
  type NavItem, type WorkContext, type WorkContextKey,
} from "@/components/layout/navConfig";

// What the sidebar / drawer show for the signed-in login: the items of the
// context it is working as, plus the contexts it can switch between (empty when
// it holds no seats).
export function useWorkContext(): { items: NavItem[]; contexts: WorkContext[]; active: WorkContextKey | null } {
  const user = useAuthStore((s) => s.user);
  const chosen = useWorkContextStore((s) => (user ? s.chosen[user.uid] : undefined));
  const pathname = usePathname();
  if (!user) return { items: [], contexts: [], active: null };
  const roles = user.roles ?? user.seatRoles ?? [];
  const active = resolveWorkContext(user.role, roles, chosen, pathname);
  return {
    items: getNavItemsForContext(user.role, roles, active ?? "ME"),
    contexts: getWorkContexts(user.role, roles),
    active,
  };
}
