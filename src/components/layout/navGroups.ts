import type { NavItem } from "./navConfig";

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
