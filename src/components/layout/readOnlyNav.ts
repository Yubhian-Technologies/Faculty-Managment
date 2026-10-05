import { getNavItemsForRole, type NavItem } from "@/components/layout/navConfig";
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

const READ_ONLY_MENU = ["/panel/profile", "/panel/leave", "/panel/attendance"];

/**
 * The WHOLE menu of a read-only person: My Profile, My Leave, My Attendance - nothing else. Used instead of the
 * normal menu (not as a filter on it), so it cannot come out empty because of a college's module settings, a
 * custom menu or the work-context switcher, and it includes My Profile, which the normal sidebar leaves to the
 * avatar menu. Built from the faculty nav so labels and icons stay in step with it.
 */
export function readOnlyNavItems(): NavItem[] {
  const faculty = getNavItemsForRole("PANEL_MEMBER");
  const out: NavItem[] = [];
  for (const href of READ_ONLY_MENU) {
    const item = faculty.find((n) => n.href === href);
    if (!item) continue;
    const { section: _drop, ...rest } = item;
    void _drop;
    out.push(out.length === 0 ? { ...rest, section: "My records" } : rest);
  }
  return out;
}
