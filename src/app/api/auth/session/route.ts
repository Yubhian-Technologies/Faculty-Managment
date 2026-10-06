export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/auth/verifyFirebaseToken";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import { LOCATION_SCOPED_ROLES } from "@/types";
import { signSession } from "@/lib/auth/sessionToken";
import { orderHeldRoles } from "@/lib/roles/seatRoles";
import { activeDelegatedRoles } from "@/lib/leave/roleDelegation";
import { migrateUserDoc } from "@/lib/faculty/fieldRenames";
import { isFacultyCapableRole } from "@/lib/auth/readOnlyAccess";
import { isFacultyExited } from "@/lib/auth/readOnlyFacultyLookup";

export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as { token?: string };
    const { token } = body;

    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    const decoded = await verifyFirebaseToken(token);

    // JWT custom claims are the fast path (set for older users / admins).
    // Fall back to Firestore for users created via REST API (no custom claims).
    let role = (decoded.role as string) ?? "";
    let collegeId = (decoded.collegeId as string) ?? "";
    let locationId = (decoded.locationId as string) ?? "";
    let name = (decoded.name as string) ?? "";
    let email = decoded.email ?? "";

    const claimsWereSet = !!role; // already in token - no need to backfill

    if (!role) {
      try {
        const db = getAdminDb();
        const snap = await db.collection("systemUsers").doc(decoded.uid).get();
        const data = snap.data() as {
          role?: string; collegeId?: string; locationId?: string;
          name?: string; email?: string;
        } | undefined;
        role = data?.role ?? "UNKNOWN";
        collegeId = data?.collegeId ?? "";
        locationId = data?.locationId ?? "";
        name = data?.name ?? name;
        email = data?.email ?? email;
      } catch {
        role = "UNKNOWN";
      }
    }

    // College Admin behaves exactly like Principal (same dashboard, same
    // permissions) - normalize here so the session cookie, custom claims, and
    // the profile below all read "PRINCIPAL" everywhere auth is checked. The
    // Firestore user doc itself keeps its real "COLLEGE_ADMIN" role so it still
    // shows up as its own entry in staff lists.
    if (role === "COLLEGE_ADMIN") role = "PRINCIPAL";

    // Director (Super Admin-provisioned, L3 · College Leadership) follows the
    // exact same normalization for the exact same reason - full Principal
    // authority, own real role preserved on the Firestore doc.
    if (role === "DIRECTOR") role = "PRINCIPAL";

    // A department's own office head carries the same authority as that
    // department's HOD, so it normalizes the same way for exactly the same
    // reason: ~420 role==="HOD" checks across 154 files keep working untouched
    // and can never drift out of step. Their department scope comes from the
    // user doc's own `department`/`departments` (getHodDepartmentScope reads
    // those, not the role), so they're scoped to their own department only.
    // `realRole` below stays "DEPARTMENT_OFFICE" and is what fences them out of
    // appointing another office head or removing a Sub-HOD.
    if (role === "DEPARTMENT_OFFICE") role = "HOD";

    // `realRole` preserves the true underlying role for the rare feature that
    // must tell College Admin apart from Principal despite the normalization
    // above (see SessionPayload.realRole / FMSUser.realRole). Can't just
    // capture `role` before the line above - once custom claims are backfilled
    // (see below) a returning College Admin's JWT already carries the
    // normalized "PRINCIPAL", so `role` never reads "COLLEGE_ADMIN" again on
    // later logins. Instead this defaults to `role` and gets corrected below
    // from the Firestore user doc, which always keeps the true role - that
    // fetch already happens on every session call, not just the first.
    let realRole: string = role;

    // Backfill Firebase Auth custom claims so client-side Firestore rules work.
    // Only write when claims were missing from the token (avoid redundant writes).
    if (!claimsWereSet && role !== "UNKNOWN") {
      try {
        const adminAuth = await getAdminAuth();
        const claims: Record<string, string> = { role };
        if (collegeId) claims.collegeId = collegeId;
        if (locationId) claims.locationId = locationId;
        await adminAuth.setCustomUserClaims(decoded.uid, claims);
      } catch { /* non-fatal - session still works without custom claims */ }
    }

    // Fetch full Firestore user profile server-side (bypasses security rules).
    // College roles → colleges/{id}/users/{uid}
    // Location roles → locations/{id}/locationUsers/{uid}
    let profile: Record<string, unknown> | null = null;
    const db = getAdminDb();

    const LOCATION_ROLES = LOCATION_SCOPED_ROLES as string[];

    if (role !== "UNKNOWN" && LOCATION_ROLES.includes(role) && locationId) {
      try {
        const userSnap = await db
          .collection("locations")
          .doc(locationId)
          .collection("locationUsers")
          .doc(decoded.uid)
          .get();
        if (userSnap.exists) {
          profile = { uid: userSnap.id, ...userSnap.data() };
        }
      } catch { /* non-fatal */ }
    } else if (role !== "UNKNOWN" && collegeId) {
      try {
        const userSnap = await db
          .collection("colleges")
          .doc(collegeId)
          .collection("users")
          .doc(decoded.uid)
          .get();
        if (userSnap.exists) {
          // Lift legacy personal/academicProfile key names so the client only sees the new ones.
          profile = { uid: userSnap.id, ...migrateUserDoc(userSnap.data() ?? {}) };
          if (profile.role === "COLLEGE_ADMIN") {
            realRole = "COLLEGE_ADMIN";
            profile.role = "PRINCIPAL";
          }
          if (profile.role === "DIRECTOR") {
            realRole = "DIRECTOR";
            profile.role = "PRINCIPAL";
          }
          if (profile.role === "DEPARTMENT_OFFICE") {
            realRole = "DEPARTMENT_OFFICE";
            profile.role = "HOD";
          }
        }
      } catch { /* non-fatal */ }
    }

    // Every role this login can act as: its primary role plus the role of each
    // seat it holds (see types/roleSeats.ts). The sidebar and page access are
    // built from this list; API guards re-check it live, so a seat handed to
    // someone else takes effect immediately, not when this cookie expires.
    // A deactivated account is also disabled in Firebase Auth; this stops a session being issued
    // from an ID token that was minted just before that happened.
    if (profile && profile.isActive === false) {
      return NextResponse.json({ error: "This account has been deactivated" }, { status: 403 });
    }

    const seatRoles = Array.isArray(profile?.seatRoles) ? (profile.seatRoles as string[]) : [];
    // Holding the College Admin seat makes someone a College Admin for the few
    // things that tell it apart from a Principal (see SessionPayload.realRole),
    // exactly as a dedicated College Admin login always was.
    if (seatRoles.includes("COLLEGE_ADMIN")) realRole = "COLLEGE_ADMIN";
    // Same for the Department Office seat, which an HOD hands to one of their
    // own faculty (see api/college/department-office). Their `role` becomes
    // "HOD" through orderHeldRoles below, exactly as a standalone
    // DEPARTMENT_OFFICE login's does - and `realRole` is what stops them
    // appointing, and so replacing, another office head.
    if (seatRoles.includes("DEPARTMENT_OFFICE")) realRole = "DEPARTMENT_OFFICE";
    // Plus any seats handed to this person for someone's leave, live today.
    let delegatedRoles: string[] = [];
    // Departments of a delegated HOD seat. Sent separately (not folded into
    // `profile`) because the client's fast path reads its profile straight from
    // Firestore; useAuth merges these into `departments` itself, mirroring what
    // getHodDepartmentScope does server-side.
    let delegatedDepartments: string[] = [];
    if (collegeId && profile) {
      try {
        const delegation = await activeDelegatedRoles(getAdminDb(), collegeId, decoded.uid);
        delegatedRoles = delegation.roles;
        if (delegatedRoles.includes("HOD")) delegatedDepartments = delegation.departments;
      } catch { /* non-fatal */ }
    }
    let roles = role === "UNKNOWN" ? [role] : orderHeldRoles(role, [...seatRoles, ...delegatedRoles]);

    // A RESIGNED/RETIRED faculty member signs in normally but is READ-ONLY (see
    // lib/auth/readOnlyAccess.ts): derived from facultyMembers.status, in every
    // college (only faculty-capable roles cost the one lookup). They hold no
    // seat, so the roles carried in the cookie and sent to the client are just
    // their own role - the seat menus/pages disappear. The API guards re-check the
    // status live on every request regardless, so this only keeps the UI honest.
    let readOnlyAccess = false;
    if (collegeId && profile && role !== "UNKNOWN" && isFacultyCapableRole(profile.role as string)) {
      try { readOnlyAccess = await isFacultyExited(db, collegeId, decoded.uid); } catch { /* non-fatal - the guards enforce it anyway */ }
    }
    if (readOnlyAccess) {
      roles = [role];
      realRole = role;
    }

    const sessionData = {
      uid: decoded.uid,
      email,
      role,
      realRole,
      roles,
      collegeId,
      locationId,
      exp: decoded.exp,
    };

    const sessionCookie = await signSession(sessionData);

    const response = NextResponse.json({ ok: true, role, realRole, roles, delegatedDepartments, collegeId, locationId, name, email, profile, refreshToken: !claimsWereSet, ...(readOnlyAccess ? { readOnlyAccess: true } : {}) });
    response.cookies.set("fms-session", sessionCookie, {
      httpOnly: true,
      // Not just a NODE_ENV check: a staging/preview deploy reachable over the
      // public internet is not "development" but also isn't NODE_ENV=production,
      // and would otherwise send this cookie unencrypted. Only plain localhost
      // (no TLS available at all) is exempt.
      secure: new URL(request.url).hostname !== "localhost",
      sameSite: "strict",
      maxAge: 60 * 60 * 24,
      path: "/",
    });

    return response;
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[auth/session] token verification failed:", message);
    // Never echo verifier internals (e.g. which key ids are known, why a
    // revocation check failed) back to the client - log server-side only.
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  // Must match the path the cookie was set with (path: "/" above) - the
  // bare-name overload's default path isn't guaranteed to line up with it.
  response.cookies.delete({ name: "fms-session", path: "/" });
  return response;
}
