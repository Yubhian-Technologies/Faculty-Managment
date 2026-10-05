import { getNavItemsForRole, groupNavItemsByModule, isPersonalNavItem, isProfileNavItem, isSettingsNavItem } from "@/components/layout/navConfig";

// Which of the HOD's modules a Department Office head can see. The office head
// reads as "HOD" everywhere, so by default they get the HOD's whole sidebar; the
// real HOD can narrow that to a chosen set. Stored per department as the list of
// ALLOWED hrefs (`null` / never saved = unrestricted, the behaviour before this
// existed, so nobody is locked out by the upgrade).
//
// Only HOD *modules* are configurable. The dashboard, the person's own profile /
// leave / attendance, and the HOD-only "Department Office" appointment page are
// never part of the list: they are not the HOD's to withhold.

export interface OfficeModuleGroup { name: string; items: { label: string; href: string }[] }

const DEPARTMENT_OFFICE = "DEPARTMENT_OFFICE";

const configurable = () =>
  getNavItemsForRole("HOD").filter(
    (i) =>
      i.href !== "/hod" &&
      !isPersonalNavItem(i) &&
      !isProfileNavItem(i) &&
      !isSettingsNavItem(i) &&
      !i.hideForRealRoles?.includes(DEPARTMENT_OFFICE)
  );

export function officeModuleCatalog(): OfficeModuleGroup[] {
  const ok = new Set(configurable().map((i) => i.href));
  return groupNavItemsByModule(getNavItemsForRole("HOD"))
    .map((g) => ({ name: g.name, items: g.items.filter((i) => ok.has(i.href)).map((i) => ({ label: i.label, href: i.href })) }))
    .filter((g) => g.items.length > 0);
}

export const officeCatalogHrefs = (): string[] => configurable().map((i) => i.href);

/** The HOD hrefs to hide from an office head, given the allowed list (null = no restriction). */
export function officeHiddenHrefs(allowed: readonly string[] | null | undefined): string[] {
  if (!allowed) return [];
  const keep = new Set(allowed);
  return officeCatalogHrefs().filter((h) => !keep.has(h));
}

/** Validates an allowed list from a request: only known modules, de-duplicated. Returns null when it holds an unknown href. */
export function sanitizeOfficeHrefs(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.some((h) => typeof h !== "string")) return null;
  const known = new Set(officeCatalogHrefs());
  const unique = Array.from(new Set(input as string[]));
  return unique.every((h) => known.has(h)) ? unique : null;
}
