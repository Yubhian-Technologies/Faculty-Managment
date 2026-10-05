// Read-only access for RESIGNED / RETIRED faculty.
//
// A faculty member whose facultyMembers.status is RESIGNED or RETIRED can still
// sign in (their account is NOT disabled, isActive/Auth/role are untouched), but
// can only VIEW their own profile and historical data. The state is DERIVED from
// facultyMembers.status at check time - nothing is stored on users/systemUsers -
// so setting the status back to a non-exited value restores normal access with no
// second field to update.
//
// This module is deliberately pure (no Firestore, no Next imports) so proxy.ts
// can import the header names. The enforcement lives in lib/auth/liveRoles.ts.
//
// Applies to EVERY college - there is no per-college switch.

/** facultyMembers.status values that make a login read-only. */
export const READ_ONLY_FACULTY_STATUSES = ["RESIGNED", "RETIRED"] as const;

export function isReadOnlyFacultyStatus(status: unknown): boolean {
  return typeof status === "string" && (READ_ONLY_FACULTY_STATUSES as readonly string[]).includes(status);
}

/**
 * Primary roles whose login can be linked to a facultyMembers record. In practice
 * a faculty member's own role is PANEL_MEMBER; the old role-accounts (HOD /
 * DEPARTMENT_OFFICE) are included because one can also be linked to a faculty
 * record. Every other role short-circuits - no lookup, no cost.
 */
export const FACULTY_CAPABLE_ROLES = ["PANEL_MEMBER", "HOD", "DEPARTMENT_OFFICE"] as const;

export function isFacultyCapableRole(role: unknown): boolean {
  return typeof role === "string" && (FACULTY_CAPABLE_ROLES as readonly string[]).includes(role);
}

// ─── Request shape handed from proxy.ts to the role guard ──────────────────
// The route guards (requireRole) never see the HTTP method or the path, and
// verifySession.ts is protected, so proxy.ts stamps both on every /api request
// (always OVERWRITING any value the client sent) and liveRoles.ts reads them.
export const METHOD_HEADER = "x-fms-method";
export const PATH_HEADER = "x-fms-path";

export function isReadMethod(method: string | null | undefined): boolean {
  const m = (method ?? "").toUpperCase();
  return m === "GET" || m === "HEAD";
}

/**
 * The ONLY requests a read-only person may make: reads of their own profile and
 * history. Everything else - every write, and every read not listed here - is
 * denied. Each entry was checked to (a) return only the caller's own data for a
 * PANEL_MEMBER and (b) perform no Firestore write inside its GET handler.
 * Add to this list deliberately; the default for a new route is "denied".
 */
const ALLOWED_GET_PATHS = new Set([
  "/api/college/faculty/me",
  "/api/college/attendance",
  "/api/college/attendance/today-status",
  "/api/leave/applications",
  "/api/leave/balances",
  "/api/leave/profile",
  "/api/leave/attendance-calendar",
  "/api/leave/period-coverage",
  "/api/college/faculty/my-assignments",
  "/api/college/notifications",
  "/api/college/settings/general",
  "/api/college/info",
]);
// One leave application by id (GET /api/leave/applications/<id>) - no deeper segments.
const LEAVE_APPLICATION_BY_ID = /^\/api\/leave\/applications\/[^/]+$/;

export function isAllowedReadOnlyRequest(method: string | null | undefined, path: string | null | undefined): boolean {
  if (!isReadMethod(method) || !path) return false;
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return ALLOWED_GET_PATHS.has(clean) || LEAVE_APPLICATION_BY_ID.test(clean);
}

/** The panel pages (UI) a read-only person may open. The server is the authority; this only avoids a wall of failed calls. */
export function isAllowedReadOnlyPage(pathname: string): boolean {
  if (/\/edit(\/|$)/.test(pathname) || pathname.startsWith("/panel/leave/apply")) return false;
  return ["/panel/profile", "/panel/attendance", "/panel/leave"].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
