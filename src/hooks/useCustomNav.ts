"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { useWorkContext } from "@/hooks/useWorkContext";
import { departmentOfContext } from "@/lib/roles/activeHodDepartment";
import { applyNavLayout, customPagesToNavItems } from "@/lib/customNav/applyLayout";
import { customPageHref } from "@/types";
import type { NavItem } from "@/components/layout/navConfig";
import type { CustomNavLayout, CustomPageSummary, UserRole } from "@/types";

interface CustomNavResponse {
  pages: CustomPageSummary[];
  order: CustomNavLayout["order"];
}

/**
 * The Super Admin's per-college sidebar customisation, ready to apply to the
 * items the Sidebar / MobileDrawer already built. `apply` is a no-op for a
 * college that has customised nothing (or while the data is still loading),
 * so the sidebar never waits on this and never changes shape unexpectedly.
 */
export function useCustomNav() {
  const user = useAuthStore((s) => s.user);
  const { active } = useWorkContext();
  const { data } = useQuery({
    queryKey: ["custom-nav", user?.collegeId],
    enabled: !!user?.collegeId,
    queryFn: async (): Promise<CustomNavResponse> => {
      const res = await fetch("/api/college/custom-nav", { cache: "no-store" });
      if (!res.ok) return { pages: [], order: {} };
      return (await res.json()) as CustomNavResponse;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  // The role whose sidebar is on screen: the seat being worked as, else the login's own.
  const role = user
    ? ((active && active !== "ME" ? (departmentOfContext(active) !== null ? "HOD" : active) : user.role) as UserRole)
    : undefined;

  const apply = useCallback(
    (items: NavItem[], hiddenHrefs: readonly string[]): NavItem[] => {
      if (!data || !role) return items;
      const customItems = customPagesToNavItems(data.pages, [role], customPageHref);
      return applyNavLayout(items, { order: data.order[role], customItems, hiddenHrefs });
    },
    [data, role]
  );

  return { apply };
}
