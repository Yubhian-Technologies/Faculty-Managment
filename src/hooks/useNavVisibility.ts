import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { getNavItemsForRole, groupNavItemsByModule } from "@/components/layout/navConfig";
import type { UserRole } from "@/types";

type PerRole = Partial<Record<UserRole, string[]>>;

// Only meaningful once a login has been made Timetable Incharge for a
// course-year (see TimetableIncharge in types/core.ts) - hidden for everyone
// else, regardless of the Super Admin's own settings.
const TIMETABLE_INCHARGE_HREFS = [
  "/panel/timetable-incharge", "/panel/assignment-requests",
  "/college-staff/timetable-incharge", "/college-staff/assignment-requests",
];
const INCHARGE_ELIGIBLE_ROLES: UserRole[] = ["PANEL_MEMBER", "COLLEGE_STAFF"];

export function useNavVisibility() {
  const user = useAuthStore((s) => s.user);
  const [raw, setRaw] = useState<{ hiddenModules: PerRole; hiddenItems: PerRole }>({ hiddenModules: {}, hiddenItems: {} });
  const [loading, setLoading] = useState(!!user?.collegeId);

  const primary = user?.role;
  const seatRoles = user?.roles ?? user?.seatRoles;
  const canBeIncharge = !!primary && !!user?.collegeId &&
    [primary, ...(seatRoles ?? [])].some((r) => INCHARGE_ELIGIBLE_ROLES.includes(r));
  // null = not yet known; the nav stays in its loading state until it is.
  const [isIncharge, setIsIncharge] = useState<boolean | null>(canBeIncharge ? null : false);

  useEffect(() => {
    if (!canBeIncharge) { setIsIncharge(false); return; }
    let cancelled = false;
    fetch("/api/college/timetable-incharges?mine=true", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ incharges?: unknown[] }>)
      .then((d) => { if (!cancelled) setIsIncharge((d.incharges?.length ?? 0) > 0); })
      // Can't tell -> keep the entry visible rather than lock a real Incharge out.
      .catch(() => { if (!cancelled) setIsIncharge(true); });
    return () => { cancelled = true; };
  }, [canBeIncharge, user?.uid]);

  useEffect(() => {
    if (!user?.collegeId) { setLoading(false); return; }
    setLoading(true);
    fetch("/api/college/settings/nav-visibility", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ hiddenModules?: PerRole; hiddenItems?: PerRole }>)
      .then((d) => setRaw({ hiddenModules: d.hiddenModules ?? {}, hiddenItems: d.hiddenItems ?? {} }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.collegeId, user?.role]);

  const hiddenItems = useMemo(() => {
    if (!primary) return [];
    // The Super Admin configures rules per role, but a login can act as several
    // (e.g. a faculty account holding the Principal or HOD seat) and its sidebar
    // shows that seat's items. Apply the rules of EVERY held role, not just the
    // primary one, and expand each role's hidden modules into that role's own
    // item hrefs (module names like "Personal" repeat across roles, so they
    // can't be matched by name once roles are combined).
    const held = Array.from(new Set<UserRole>([primary, ...(seatRoles ?? [])]));
    const hrefs = new Set<string>();
    for (const role of held) {
      raw.hiddenItems[role]?.forEach((h) => hrefs.add(h));
      const hiddenMods = raw.hiddenModules[role];
      if (hiddenMods?.length) {
        for (const mod of groupNavItemsByModule(getNavItemsForRole(role))) {
          if (hiddenMods.includes(mod.name)) mod.items.forEach((i) => hrefs.add(i.href));
        }
      }
    }
    if (isIncharge === false) TIMETABLE_INCHARGE_HREFS.forEach((h) => hrefs.add(h));
    return Array.from(hrefs);
  }, [raw, primary, seatRoles, isIncharge]);

  // Modules are already folded into hiddenItems above.
  return { hiddenModules: [] as string[], hiddenItems, loading: loading || isIncharge === null };
}
