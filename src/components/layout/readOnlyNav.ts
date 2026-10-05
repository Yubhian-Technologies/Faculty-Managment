import { getNavItemsForRole } from "@/components/layout/navConfig";
import { isAllowedReadOnlyPage } from "@/lib/auth/readOnlyAccess";

/**
 * Sidebar / drawer / bottom-bar entries to hide for a read-only person (a RESIGNED/RETIRED faculty member):
 * every faculty menu item that is not one of the pages they may open (profile, attendance history, leave
 * history). Built from the existing faculty nav - navConfig itself is not changed. Purely cosmetic: the server
 * denies everything else regardless, and a direct visit to a hidden page still shows the read-only notice.
 */
export function readOnlyHiddenHrefs(): string[] {
  return getNavItemsForRole("PANEL_MEMBER").map((i) => i.href).filter((href) => !isAllowedReadOnlyPage(href));
}
