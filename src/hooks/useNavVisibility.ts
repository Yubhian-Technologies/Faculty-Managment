import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { useMyAssignments } from "@/hooks/useMyAssignments";
import { useOfficeAllowedHrefs } from "@/hooks/useOfficeAllowedHrefs";
import { officeHiddenHrefs } from "@/lib/departments/officeAccess";
import { getNavItemsForRole, groupNavItemsByModule } from "@/components/layout/navConfig";
import type { UserRole } from "@/types";

type PerRole = Partial<Record<UserRole, string[]>>;

// Tabs that only make sense for someone holding the matching duty - hidden for
// everyone else, regardless of the Super Admin's own settings. Which duties a
// login holds comes from useMyAssignments (one request, cached).
const TIMETABLE_INCHARGE_HREFS = [
  "/panel/timetable-incharge", "/panel/assignment-requests",
  "/college-staff/timetable-incharge", "/college-staff/assignment-requests",
];
const SECTION_INCHARGE_HREFS = ["/panel/students", "/panel/students/batches"];
const MID_PAPER_HREFS = ["/panel/mid-bank"];
const DUTY_ROLES: UserRole[] = ["PANEL_MEMBER", "COLLEGE_STAFF"];

export function useNavVisibility() {
  const user = useAuthStore((s) => s.user);
  const [raw, setRaw] = useState<{ hiddenModules: PerRole; hiddenItems: PerRole }>({ hiddenModules: {}, hiddenItems: {} });
  const [loading, setLoading] = useState(!!user?.collegeId);

  const primary = user?.role;
  const seatRoles = user?.roles ?? user?.seatRoles;
  const canBeIncharge = !!primary && !!user?.collegeId &&
    [primary, ...(seatRoles ?? [])].some((r) => DUTY_ROLES.includes(r));
  // null = not yet known; the nav stays in its loading state until it is.
  const assignments = useMyAssignments(canBeIncharge);
  // A Department Office head's sidebar is narrowed to what their HOD allowed.
  const officeAllowed = useOfficeAllowedHrefs(user?.realRole === "DEPARTMENT_OFFICE");

  useEffect(() => {
    if (!user?.collegeId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    if (officeAllowed.hrefs) officeHiddenHrefs(officeAllowed.hrefs).forEach((h) => hrefs.add(h));
    if (assignments) {
      if (!assignments.timetableIncharge) TIMETABLE_INCHARGE_HREFS.forEach((h) => hrefs.add(h));
      if (!assignments.sectionIncharge) SECTION_INCHARGE_HREFS.forEach((h) => hrefs.add(h));
      if (!assignments.midPaperSetter) MID_PAPER_HREFS.forEach((h) => hrefs.add(h));
    }
    return Array.from(hrefs);
  }, [raw, primary, seatRoles, assignments, officeAllowed.hrefs]);

  const hiddenModules = useMemo(() => {
    if (!primary) return [];
    const held = Array.from(new Set<UserRole>([primary, ...(seatRoles ?? [])]));
    const mods = new Set<string>();
    for (const role of held) {
      raw.hiddenModules[role]?.forEach((m) => mods.add(m));
    }
    return Array.from(mods);
  }, [raw, primary, seatRoles]);

  return { hiddenModules, hiddenItems, loading: loading || (canBeIncharge && assignments === null) || officeAllowed.loading };
}
