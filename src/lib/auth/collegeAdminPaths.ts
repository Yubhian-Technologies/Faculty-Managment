import { ROLE_DASHBOARD_PATHS } from "@/types/core";

// A College Admin login has its own URL space, /college-admin/..., served from the Principal's pages
// (and the R&D office's under /college-admin/r-and-d) by the rewrites in next.config.ts. Its auth role
// is still PRINCIPAL, so everything that picks a URL for it goes through here.

export const COLLEGE_ADMIN_HOME = "/college-admin";

export const isCollegeAdminRole = (realRole?: string | null): boolean => realRole === "COLLEGE_ADMIN";

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);

/** "/principal/courses" -> "/college-admin/courses", "/r-and-d/publications" -> "/college-admin/r-and-d/publications". */
export function toCollegeAdminPath(path: string): string {
  if (under(path, "/principal")) return COLLEGE_ADMIN_HOME + path.slice("/principal".length);
  if (under(path, "/r-and-d")) return `${COLLEGE_ADMIN_HOME}${path}`;
  return path;
}

/** The page behind a College Admin URL - what nav visibility and the active highlight are keyed on. */
export function fromCollegeAdminPath(path: string): string {
  if (under(path, `${COLLEGE_ADMIN_HOME}/r-and-d`)) return path.slice(COLLEGE_ADMIN_HOME.length);
  if (under(path, COLLEGE_ADMIN_HOME)) return "/principal" + path.slice(COLLEGE_ADMIN_HOME.length);
  return path;
}

/** True for a page a College Admin should be seen on only under /college-admin. */
export const isCollegeAdminRewriteSource = (path: string): boolean => under(path, "/principal") || under(path, "/r-and-d");

/** Where a login lands: its role's dashboard, or /college-admin for a College Admin. */
export function dashboardPathFor(role: string | undefined, realRole?: string | null): string | undefined {
  if (isCollegeAdminRole(realRole)) return COLLEGE_ADMIN_HOME;
  return role ? ROLE_DASHBOARD_PATHS[role as keyof typeof ROLE_DASHBOARD_PATHS] : undefined;
}
