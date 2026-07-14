"use client";

import { useAuthStore } from "@/store/authStore";
import type { UserRole } from "@/types";

export function useRole() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role ?? null;

  const hasRole = (...roles: UserRole[]): boolean =>
    role !== null && roles.includes(role);

  const isAdmin = hasRole("SUPER_ADMIN");
  const isPrincipal = hasRole("PRINCIPAL");
  const isHOD = hasRole("HOD");
  const isCollegeOffice = hasRole("COLLEGE_OFFICE");
  const isPanelMember = hasRole("PANEL_MEMBER");
  const isAccounts = hasRole("ACCOUNTS");
  const isFinance = hasRole("FINANCE");
  const isPurchaseDept = hasRole("PURCHASE_DEPT");

  return { role, hasRole, isAdmin, isPrincipal, isHOD, isCollegeOffice, isPanelMember, isAccounts, isFinance, isPurchaseDept };
}
