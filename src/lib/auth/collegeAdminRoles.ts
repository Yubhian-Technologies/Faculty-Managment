// A College Admin is a role-login, not a person (no profile, attendance or leave of its own). Besides the
// Principal-level authority it already has, it manages the college's Research & Development records, so it
// also HOLDS the R&D role: the R&D APIs (api/college/publications, research-review, ...) only admit a login
// that holds "R_AND_D", and every "is this the R&D office" check reads the same held list.
//
// This is the ONLY place that grants it, applied by lib/auth/liveRoles.ts after the held roles are worked
// out. It is for the real College Admin login alone - a Principal, Vice Principal or Director never gets it
// - and only while the login holds any role at all (a deactivated or signed-out login holds none and keeps none).

export const COLLEGE_ADMIN_EXTRA_ROLES: readonly string[] = ["R_AND_D"];

export function withCollegeAdminRoles(realRole: string, held: string[]): string[] {
  if (realRole !== "COLLEGE_ADMIN" || held.length === 0) return held;
  const extra = COLLEGE_ADMIN_EXTRA_ROLES.filter((r) => !held.includes(r));
  return extra.length === 0 ? held : [...held, ...extra];
}
