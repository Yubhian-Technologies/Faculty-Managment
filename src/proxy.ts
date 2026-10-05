import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth/sessionToken";
import type { NextRequest } from "next/server";
import { ROLE_DASHBOARD_PATHS, rolesInheritedBy } from "@/types/core";
import type { UserRole } from "@/types/core";
import { METHOD_HEADER, PATH_HEADER } from "@/lib/auth/readOnlyAccess";

// "/" is public so signed-out visitors land on the marketing page (src/app/page.tsx)
// instead of being force-redirected to /login before it can render; that page
// still client-side redirects signed-in users to their dashboard as before.
// The matcher's "public/" exclusion below doesn't actually cover files served
// from the public/ folder (Next.js serves them at the site root, not under
// /public/), so images that page references need to be listed here explicitly.
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/careers",
  "/feedback",
  "/api/auth",
  "/location-interview",
  "/candidate-form",
  "/offer-acceptance",
  "/faculty-public",
  "/about-team-illustration.png",
  // Letterhead logo for generated timetables (lib/timetable/logoAsset.ts) -
  // fetched by the PDF renderer and the spreadsheet export.
  "/vishnulogo.png",
  // face-api.js model weights (public/models/) - fetched client-side by
  // MarkAttendanceDialog regardless of which authenticated role is checking
  // in, so this must stay reachable rather than fall under role path gating.
  "/models",
];

// /panel/interviews is shared - any staff role can be added as a panel member
const PANEL_INTERVIEWS_PATH = "/panel/interviews";
// /evaluation is the shared demo/interview scoring page - reachable by
// exactly the same roles as /panel/interviews, since any of them can be
// assigned as a panelist on a hiring batch.
const EVALUATION_PATH = "/evaluation";
// /candidate-profile is the shared read-only candidate dossier - reachable by
// HOD, Principal/VP and College Office (they each already read the same
// candidate/letter data via the college API guards).
const CANDIDATE_PROFILE_PATH = "/candidate-profile";
// /leave/adjustments (accept/decline a substitute/handover request) and
// /leave/revise/[id] (pick someone else after a decline) are shared across
// every leave-applicant role - see /api/leave/adjustment-requests and
// /api/leave/applications/[id]/adjustment-response.
const LEAVE_ADJUSTMENTS_PATH = "/leave";

// Per-role *own* (and explicitly-shared) path prefixes. Inherited lower-level
// dashboard paths are added on top of these by allowedPathsForRole().
const ROLE_PATH_MAP: Record<string, string[]> = {
  SUPER_ADMIN: ["/super-admin", PANEL_INTERVIEWS_PATH, EVALUATION_PATH],
  MANAGEMENT: ["/management"],
  WEBMASTER: ["/webmaster", LEAVE_ADJUSTMENTS_PATH],
  ADMINISTRATION: ["/administration", "/location-staff-admin", "/location-dept-head"],
  HR_ADMIN: ["/hr-admin"],
  ADMIN_OFFICE: ["/admin-office"],
  LOCATION_STAFF_ADMIN: ["/location-staff-admin", "/location-dept-head"],
  PLACEMENT_DEPT: ["/placement-dept", LEAVE_ADJUSTMENTS_PATH],
  LIBRARY: ["/library", LEAVE_ADJUSTMENTS_PATH],
  EXAM_CELL: ["/exam-cell", LEAVE_ADJUSTMENTS_PATH],
  LOCATION_DEPT_HEAD: ["/location-dept-head"],
  PRINCIPAL: ["/principal", PANEL_INTERVIEWS_PATH, EVALUATION_PATH, CANDIDATE_PROFILE_PATH, LEAVE_ADJUSTMENTS_PATH],
  // Vice Principal mirrors Principal's authority (see AGENTS.md) - full access
  // to /principal/* alongside its own /vice-principal home.
  VICE_PRINCIPAL: ["/vice-principal", "/principal", PANEL_INTERVIEWS_PATH, EVALUATION_PATH, CANDIDATE_PROFILE_PATH, LEAVE_ADJUSTMENTS_PATH],
  // College Admin mirrors Principal's authority exactly - same dashboard, no
  // separate home path of its own (role is normalized to PRINCIPAL for auth,
  // see src/app/api/auth/session/route.ts and src/hooks/useAuth.ts).
  COLLEGE_ADMIN: ["/principal", PANEL_INTERVIEWS_PATH, EVALUATION_PATH, CANDIDATE_PROFILE_PATH, LEAVE_ADJUSTMENTS_PATH],
  // Director mirrors Principal's authority exactly, same as College Admin
  // above - normalized to PRINCIPAL for auth (api/auth/session, useAuth.ts).
  DIRECTOR: ["/principal", PANEL_INTERVIEWS_PATH, EVALUATION_PATH, CANDIDATE_PROFILE_PATH, LEAVE_ADJUSTMENTS_PATH],
  HOD: ["/hod", "/coordinator", PANEL_INTERVIEWS_PATH, EVALUATION_PATH, CANDIDATE_PROFILE_PATH, LEAVE_ADJUSTMENTS_PATH],
  // Normalized to HOD before the cookie is written (api/auth/session), so
  // this is only reached by a session issued before that existed - same paths.
  DEPARTMENT_OFFICE: ["/hod", "/coordinator", PANEL_INTERVIEWS_PATH, EVALUATION_PATH, CANDIDATE_PROFILE_PATH, LEAVE_ADJUSTMENTS_PATH],
  COLLEGE_OFFICE: ["/college-office", PANEL_INTERVIEWS_PATH, EVALUATION_PATH, CANDIDATE_PROFILE_PATH, LEAVE_ADJUSTMENTS_PATH],
  COLLEGE_STAFF: ["/college-staff", LEAVE_ADJUSTMENTS_PATH],
  ACADEMICS: ["/academics", LEAVE_ADJUSTMENTS_PATH],
  IQAC_COORDINATOR: ["/iqac-coordinator", LEAVE_ADJUSTMENTS_PATH],
  T_AND_P: ["/t-and-p", LEAVE_ADJUSTMENTS_PATH],
  R_AND_D: ["/r-and-d", LEAVE_ADJUSTMENTS_PATH],
  RND_COORDINATOR: ["/rnd-coordinator"],
  PANEL_MEMBER: ["/panel", "/coordinator", EVALUATION_PATH, LEAVE_ADJUSTMENTS_PATH],
  ACCOUNTS: ["/accounts", PANEL_INTERVIEWS_PATH, EVALUATION_PATH, CANDIDATE_PROFILE_PATH, LEAVE_ADJUSTMENTS_PATH],
  COLLEGE_ACCOUNTS: ["/college-accounts", CANDIDATE_PROFILE_PATH],
  FINANCE: ["/finance", LEAVE_ADJUSTMENTS_PATH],
  PURCHASE_DEPT: ["/purchase", LEAVE_ADJUSTMENTS_PATH],
  CLASS_LEADER: ["/class-leader"],
  STUDENT: ["/student"],
};

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

// A role may reach its own paths plus the dashboards of every lower-level role it
// inherits within scope (L0–L6 hierarchy). This is coarse path gating only -
// real tenant/data isolation is still enforced by the per-route API guards.
function allowedPathsForRole(role: string): string[] {
  const own = ROLE_PATH_MAP[role] ?? [];
  const inherited = rolesInheritedBy(role as UserRole)
    .map((r) => ROLE_DASHBOARD_PATHS[r])
    .filter((p): p is string => Boolean(p));
  return [...own, ...inherited];
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API requests are not gated here (every route guards itself), but the guard
  // behind them (lib/auth/liveRoles.ts) needs the HTTP method and path to give
  // a RESIGNED/RETIRED faculty member read-only access, and route guards never
  // receive either. Stamp them on EVERY /api request, always overwriting
  // whatever the client sent under the same names, so they can't be spoofed.
  if (pathname.startsWith("/api/")) {
    const headers = new Headers(request.headers);
    headers.set(METHOD_HEADER, request.method);
    headers.set(PATH_HEADER, pathname);
    return NextResponse.next({ request: { headers } });
  }

  if (isPublicPath(pathname) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get("fms-session")?.value;

  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const payload = await readSession<{ role?: string; roles?: string[]; exp?: number }>(sessionCookie);
    if (!payload) throw new Error("invalid session");

    if (payload.exp && Date.now() / 1000 > payload.exp) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      const response = NextResponse.redirect(loginUrl);
      response.cookies.delete({ name: "fms-session", path: "/" });
      return response;
    }

    const role = payload.role as string | undefined;
    if (role) {
      // A login can hold several roles at once (its own plus any seats - see
      // types/roleSeats.ts): page access is the union of each role's paths.
      // The API guards do the real, live check; this is coarse gating only.
      const heldRoles = Array.from(new Set([role, ...(payload.roles ?? [])]));
      const allowedPaths = Array.from(new Set(heldRoles.flatMap((r) => allowedPathsForRole(r))));
      // /pages/<id> are Super-Admin-built tabs (lib/customNav): open to every
      // signed-in role here, because who may open a given page is enforced by
      // its API (enabled + the page's roles + nav visibility), not by path.
      const hasAccess = allowedPaths.some((p) => pathname.startsWith(p)) || pathname.startsWith("/pages/");
      if (!hasAccess && pathname !== "/") {
        const defaultPath =
          allowedPaths[0] ?? "/login";
        return NextResponse.redirect(new URL(defaultPath, request.url));
      }
    }

    return NextResponse.next();
  } catch {
    // Unsigned / tampered / pre-signing cookie: drop it and sign in again.
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete({ name: "fms-session", path: "/" });
    return response;
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|public/).*)",
  ],
};
