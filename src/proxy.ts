import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ROLE_DASHBOARD_PATHS, rolesInheritedBy } from "@/types/core";
import type { UserRole } from "@/types/core";

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
  "/about-team-illustration.png",
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

// Per-role *own* (and explicitly-shared) path prefixes. Inherited lower-level
// dashboard paths are added on top of these by allowedPathsForRole().
const ROLE_PATH_MAP: Record<string, string[]> = {
  SUPER_ADMIN: ["/super-admin", PANEL_INTERVIEWS_PATH, EVALUATION_PATH],
  MANAGEMENT: ["/management"],
  WEBMASTER: ["/webmaster"],
  ADMINISTRATION: ["/administration"],
  HR_ADMIN: ["/hr-admin"],
  ADMIN_OFFICE: ["/admin-office"],
  PLACEMENT_DEPT: ["/placement-dept"],
  LIBRARY: ["/library"],
  EXAM_CELL: ["/exam-cell"],
  LOCATION_DEPT_HEAD: ["/location-dept-head"],
  PRINCIPAL: ["/principal", PANEL_INTERVIEWS_PATH, EVALUATION_PATH, CANDIDATE_PROFILE_PATH],
  // Vice Principal mirrors Principal's authority (see AGENTS.md) - full access
  // to /principal/* alongside its own /vice-principal home.
  VICE_PRINCIPAL: ["/vice-principal", "/principal", PANEL_INTERVIEWS_PATH, EVALUATION_PATH, CANDIDATE_PROFILE_PATH],
  HOD: ["/hod", "/coordinator", PANEL_INTERVIEWS_PATH, EVALUATION_PATH, CANDIDATE_PROFILE_PATH],
  COLLEGE_OFFICE: ["/college-office", PANEL_INTERVIEWS_PATH, EVALUATION_PATH, CANDIDATE_PROFILE_PATH],
  COLLEGE_STAFF: ["/college-staff"],
  DEAN: ["/dean"],
  IQAC_COORDINATOR: ["/iqac-coordinator"],
  T_AND_P: ["/t-and-p"],
  R_AND_D: ["/r-and-d"],
  PANEL_MEMBER: ["/panel", "/coordinator", EVALUATION_PATH],
  ACCOUNTS: ["/accounts", PANEL_INTERVIEWS_PATH, EVALUATION_PATH],
  COLLEGE_ACCOUNTS: ["/college-accounts", CANDIDATE_PROFILE_PATH],
  FINANCE: ["/finance"],
  PURCHASE_DEPT: ["/purchase"],
  CLASS_LEADER: ["/class-leader"],
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

  if (isPublicPath(pathname) || pathname.startsWith("/_next") || pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get("fms-session")?.value;

  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const payload = JSON.parse(
      Buffer.from(sessionCookie.split(".")[1], "base64").toString()
    ) as { role?: string; exp?: number };

    if (payload.exp && Date.now() / 1000 > payload.exp) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      const response = NextResponse.redirect(loginUrl);
      response.cookies.delete("fms-session");
      return response;
    }

    const role = payload.role as string | undefined;
    if (role) {
      const allowedPaths = allowedPathsForRole(role);
      const hasAccess = allowedPaths.some((p) => pathname.startsWith(p));
      if (!hasAccess && pathname !== "/") {
        const defaultPath =
          allowedPaths[0] ?? "/login";
        return NextResponse.redirect(new URL(defaultPath, request.url));
      }
    }

    return NextResponse.next();
  } catch {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|public/).*)",
  ],
};
