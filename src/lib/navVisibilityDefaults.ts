import type { NavVisibilitySettings, UserRole } from "@/types";
import { migrateHiddenModules } from "@/components/layout/navConfig";

// These pages are still placeholder ("coming soon") screens across every role
// that has one - hidden by default until each is actually built out, per college.
// Used by BOTH the Super Admin settings API (what the checkboxes show) and the
// runtime API (what the sidebar actually hides) so the two can never disagree.
export const DEFAULT_NAV_VISIBILITY: Pick<NavVisibilitySettings, "hiddenModules" | "hiddenItems"> = {
  hiddenModules: {},
  hiddenItems: {
    HOD: ["/hod/payslips", "/hod/appraisal", "/hod/training", "/hod/grievance", "/hod/documents"],
    // "/principal/attendance" and "/panel/attendance" (My Attendance) were
    // mistakenly bundled in here alongside the still-unbuilt placeholder
    // pages below - the self-attendance feature (face+geofence check-in/out)
    // had already fully shipped a month before this default-hidden list was
    // written, so it was never actually a "coming soon" page.
    PRINCIPAL: ["/principal/training", "/principal/grievance", "/principal/payslips"],
    VICE_PRINCIPAL: ["/principal/training", "/principal/grievance", "/principal/payslips"],
    PANEL_MEMBER: ["/panel/payslips", "/panel/appraisal", "/panel/training", "/panel/grievance", "/panel/documents"],
  },
};

type PerRole = Partial<Record<UserRole, string[]>>;

// Per-role merge: a role the Super Admin has saved uses its saved list exactly
// (even if empty - that is how "un-hide everything" sticks); a role never saved
// falls back to the default. A shallow `{...defaults, ...stored}` spread would
// instead drop every other role's defaults as soon as one role is saved.
function mergePerRole(defaults: PerRole, stored: PerRole | undefined): PerRole {
  const out: PerRole = { ...defaults };
  for (const [role, list] of Object.entries(stored ?? {})) {
    if (Array.isArray(list)) out[role as UserRole] = list;
  }
  return out;
}

export function resolveNavVisibility(
  stored: Partial<NavVisibilitySettings> | undefined
): Pick<NavVisibilitySettings, "hiddenModules" | "hiddenItems"> {
  // Saved module names from before a section was renamed/split still hide what they
  // used to: see migrateHiddenModules. Applied here so the Super Admin screen and
  // the runtime sidebar read the same migrated list.
  const hiddenModules = mergePerRole(DEFAULT_NAV_VISIBILITY.hiddenModules, stored?.hiddenModules);
  for (const role of Object.keys(hiddenModules) as UserRole[]) {
    hiddenModules[role] = migrateHiddenModules(role, hiddenModules[role] ?? []);
  }
  return {
    hiddenModules,
    hiddenItems: mergePerRole(DEFAULT_NAV_VISIBILITY.hiddenItems, stored?.hiddenItems),
  };
}
