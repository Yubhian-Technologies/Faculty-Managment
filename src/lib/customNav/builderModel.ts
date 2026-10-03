import type { NavItem } from "@/components/layout/navConfig";
import type { CustomPageSummary } from "@/types";
import { customPageHref } from "@/types";
import { applyNavLayout, customPagesToNavItems } from "./applyLayout";

/** One numbered line in the Super Admin's tab-layout builder. */
export interface BuilderRow {
  href: string;
  label: string;
  iconName: string;
  /** The module (sidebar section) this tab belongs to by default; "" for none. */
  module: string;
  kind: "builtin" | "custom";
  pageId?: string;
  /** Custom tabs only: the page's master switch. */
  enabled?: boolean;
}

/**
 * The full, ordered tab list for one role as the builder shows it: every
 * built-in tab (hidden ones included - hiding is a toggle, not removal) and the
 * role's custom tabs, sorted by the saved order.
 */
export function buildRows(role: string, builtIn: NavItem[], pages: readonly CustomPageSummary[], order: readonly string[] | undefined): BuilderRow[] {
  const moduleOf = new Map<string, string>();
  let current = "";
  for (const item of builtIn) {
    if (item.section) current = item.section;
    moduleOf.set(item.href, current);
  }
  const forRole = pages.filter((p) => p.roles.includes(role as CustomPageSummary["roles"][number]));
  const customItems = customPagesToNavItems(forRole, [role], customPageHref);
  const sorted = applyNavLayout(builtIn, { order, customItems });
  const pageByHref = new Map(forRole.map((p) => [customPageHref(p.id), p]));

  return sorted.map((item): BuilderRow => {
    const page = pageByHref.get(item.href);
    return {
      href: item.href,
      label: item.label,
      iconName: item.iconName,
      module: page ? page.section ?? "" : moduleOf.get(item.href) ?? "",
      kind: page ? "custom" : "builtin",
      pageId: page?.id,
      enabled: page?.enabled,
    };
  });
}

/** Moves the row at `from` so it ends up at index `to` (both clamped). */
export function moveRow<T>(rows: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= rows.length) return [...rows];
  const target = Math.max(0, Math.min(rows.length - 1, to));
  const out = [...rows];
  const [row] = out.splice(from, 1);
  out.splice(target, 0, row);
  return out;
}

/** Inserts `row` so it ends up at index `index` (clamped). */
export function insertRow<T>(rows: readonly T[], index: number, row: T): T[] {
  const at = Math.max(0, Math.min(rows.length, index));
  return [...rows.slice(0, at), row, ...rows.slice(at)];
}

export const toOrder = (rows: readonly Pick<BuilderRow, "href">[]): string[] => rows.map((r) => r.href);

/**
 * The hidden list to save for a role: whatever the college already hides that
 * the builder doesn't manage (e.g. tabs injected at runtime) is kept as is, and
 * the builder's own toggles replace the rest.
 */
export function mergeHidden(existing: readonly string[], managedHrefs: readonly string[], nowHidden: ReadonlySet<string>): string[] {
  const managed = new Set(managedHrefs);
  const kept = existing.filter((h) => !managed.has(h));
  return [...kept, ...managedHrefs.filter((h) => nowHidden.has(h))];
}
