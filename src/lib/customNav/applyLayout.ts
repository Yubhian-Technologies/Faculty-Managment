import type { NavItem } from "@/components/layout/navConfig";

/**
 * Applies a college's custom tab layout to the sidebar items a login already
 * has (built-in items AFTER the usual visibility filtering, plus any custom
 * tabs for the login's roles):
 *   1. custom tabs are added (unless hidden),
 *   2. everything is sorted by the saved order - tabs the order doesn't list
 *      keep their relative position after the listed ones,
 *   3. section headers are recomputed, because filterVisibleNavItems derives
 *      them from the DEFAULT order and a moved tab would otherwise carry a
 *      stale header into a different place.
 *
 * With no saved order and no custom tabs the input is returned untouched, so a
 * college that never customises anything behaves exactly as before.
 */
export function applyNavLayout(
  items: NavItem[],
  opts: { order?: readonly string[]; customItems?: readonly NavItem[]; hiddenHrefs?: readonly string[] }
): NavItem[] {
  const order = opts.order ?? [];
  const hidden = new Set(opts.hiddenHrefs ?? []);
  const custom = (opts.customItems ?? []).filter((c) => !hidden.has(c.href));
  if (order.length === 0 && custom.length === 0) return items;

  // Each built-in item's module = the section header it sits under right now.
  type Tagged = { item: NavItem; module: string };
  const tagged: Tagged[] = [];
  let current = "General";
  for (const item of items) {
    if (item.section) current = item.section;
    tagged.push({ item, module: current });
  }
  const have = new Set(items.map((i) => i.href));
  // A custom tab with an explicit section forms its own module; without one it
  // inherits whatever it ends up following (resolved after sorting).
  const extra: Tagged[] = custom
    .filter((c) => !have.has(c.href))
    .map((c) => ({ item: c, module: c.section ?? "" }));

  const all = [...tagged, ...extra];
  const rank = new Map(order.map((href, i) => [href, i]));
  const listed = all
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => rank.has(t.item.href))
    .sort((a, b) => rank.get(a.t.item.href)! - rank.get(b.t.item.href)! || a.i - b.i)
    .map(({ t }) => t);
  const unlisted = all.filter((t) => !rank.has(t.item.href));

  const sorted = [...listed, ...unlisted];

  let prev = "General";
  return sorted.map(({ item, module }) => {
    const mod = module || prev;
    const header = mod !== prev && mod !== "General" ? mod : undefined;
    prev = mod;
    return { ...item, section: header };
  });
}

/** Sidebar entries for a role's custom tabs. */
export function customPagesToNavItems(
  pages: readonly { id: string; title: string; iconName: string; section?: string; roles: readonly string[] }[],
  heldRoles: readonly string[],
  hrefOf: (id: string) => string
): NavItem[] {
  return pages
    .filter((p) => p.roles.some((r) => heldRoles.includes(r)))
    .map((p) => ({
      label: p.title,
      href: hrefOf(p.id),
      iconName: p.iconName,
      roles: p.roles as NavItem["roles"],
      section: p.section || undefined,
    }));
}
