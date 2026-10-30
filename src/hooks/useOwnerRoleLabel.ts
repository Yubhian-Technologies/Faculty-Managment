"use client";

import { useAuthStore } from "@/store/authStore";
import { isCollegeAdminRole } from "@/lib/auth/collegeAdminPaths";

/**
 * How a page names the person looking at it where it used to say "Principal": "College Admin" for a College
 * Admin login (its only role - it is not a Principal), "Principal" for everyone else.
 */
export function useOwnerRoleLabel(): string {
  const realRole = useAuthStore((s) => s.user?.realRole);
  return isCollegeAdminRole(realRole) ? "College Admin" : "Principal";
}
