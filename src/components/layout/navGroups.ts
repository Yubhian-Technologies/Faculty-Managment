import type { NavItem } from "./navConfig";
import { ROLE_LABELS } from "@/types/core";

export interface NavGroup {
  title: string | null;
  items: NavItem[];
}

/** The sidebar's groups: a nav item that starts a `section` opens a new group, the items after it belong to it. */
export function groupNavItems(items: NavItem[]): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const item of items) {
    if (item.section || groups.length === 0) groups.push({ title: item.section ?? null, items: [] });
    groups[groups.length - 1].items.push(item);
  }
  return groups;
}

/**
 * The sidebar / drawer groups. A "Working as" seat labels its first page with the seat's name ("Head of
 * Department") - the switcher above already says that, so the sidebar leaves that lead group untitled
 * (Dashboard sits on its own at the top, like every other role's).
 */
export function sidebarNavGroups(items: NavItem[]): NavGroup[] {
  const groups = groupNavItems(items);
  const roleNames = new Set<string>(Object.values(ROLE_LABELS));
  if (groups[0]?.title && roleNames.has(groups[0].title)) groups[0] = { ...groups[0], title: null };
  return groups;
}
