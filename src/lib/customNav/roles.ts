import { NAV_ITEMS } from "@/components/layout/navConfig";
import { ROLE_SCOPE } from "@/types";
import type { UserRole } from "@/types";

/**
 * Every college-scoped role that has a sidebar - the roles a Super Admin can
 * customise tabs for. Derived from the nav config so a newly added role shows
 * up on its own.
 *
 * Deliberately NOT getRolesWithNavModules(): that only lists roles whose items
 * are grouped under section headers, which left out STUDENT and CLASS_LEADER
 * (their sidebars are flat), so their dashboards could not be customised.
 */
export const CUSTOMIZABLE_ROLES: UserRole[] = Array.from(
  new Set(NAV_ITEMS.flatMap((item) => item.roles))
).filter((role) => ROLE_SCOPE[role] === "COLLEGE");
