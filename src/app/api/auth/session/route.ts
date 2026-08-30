export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/auth/verifyFirebaseToken";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import { LOCATION_SCOPED_ROLES } from "@/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { token?: string };
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
          profile = { uid: userSnap.id, ...userSnap.data() };
          if (profile.role === "COLLEGE_ADMIN") {
            realRole = "COLLEGE_ADMIN";
            profile.role = "PRINCIPAL";
          }
        }
      } catch { /* non-fatal */ }
    }

    const sessionData = {
      uid: decoded.uid,
      email,
      role,
      realRole,
      collegeId,
      locationId,
      exp: decoded.exp,
    };

    const sessionPayload = Buffer.from(JSON.stringify(sessionData)).toString("base64");
    const sessionCookie = `header.${sessionPayload}.signature`;

    const response = NextResponse.json({ ok: true, role, realRole, collegeId, locationId, name, email, profile, refreshToken: !claimsWereSet });
    response.cookies.set("fms-session", sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 60 * 24,
      path: "/",
    });

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[auth/session] token verification failed:", message);
    return NextResponse.json({ error: "Invalid token", detail: message }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("fms-session");
  return response;
}
