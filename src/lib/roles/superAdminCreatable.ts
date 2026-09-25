import { ROLE_SCOPE } from "@/types";
import type { UserRole } from "@/types";

// Single source of truth for roles a Super Admin can create - the level L1-L2 set (GLOBAL + LOCATION).
// Must match CREATABLE_ROLES in super-admin/users/new/page.tsx (now re-exported via this file).
export const SUPER_ADMIN_CREATABLE: UserRole[] = [
  "MANAGEMENT",
  "FINANCE",
  "PURCHASE_DEPT", // L1 - GLOBAL
  "ADMINISTRATION",
  "ACCOUNTS", // L2 - LOCATION
] as const as unknown as UserRole[];

// Global-scoped subset - used by GET ?scope=global (System-Wide) listing.
// Derived from SUPER_ADMIN_CREATABLE via ROLE_SCOPE so there is a single source of truth.
export const GLOBAL_ROLES: UserRole[] = SUPER_ADMIN_CREATABLE.filter((r) => ROLE_SCOPE[r] === "GLOBAL");
