export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/auth/verifyFirebaseToken";
import { getAdminDb } from "@/lib/firebase/admin";

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
    let name = (decoded.name as string) ?? "";
    let email = decoded.email ?? "";

    if (!role) {
      try {
        const db = getAdminDb();
        const snap = await db.collection("systemUsers").doc(decoded.uid).get();
        const data = snap.data() as {
          role?: string; collegeId?: string; name?: string; email?: string;
        } | undefined;
        role = data?.role ?? "UNKNOWN";
        collegeId = data?.collegeId ?? "";
        name = data?.name ?? name;
        email = data?.email ?? email;
      } catch {
        role = "UNKNOWN";
      }
    }

    // Also fetch the full Firestore user profile server-side (bypasses security rules)
    // so the login page can populate the auth store without needing JWT custom claims.
    let profile: Record<string, unknown> | null = null;
    if (role !== "UNKNOWN" && collegeId) {
      try {
        const db = getAdminDb();
        const userSnap = await db
          .collection("colleges")
          .doc(collegeId)
          .collection("users")
          .doc(decoded.uid)
          .get();
        if (userSnap.exists) {
          profile = { uid: userSnap.id, ...userSnap.data() };
        }
      } catch { /* non-fatal */ }
    }

    const sessionData = {
      uid: decoded.uid,
      email,
      role,
      collegeId,
      exp: decoded.exp,
    };

    const sessionPayload = Buffer.from(JSON.stringify(sessionData)).toString("base64");
    const sessionCookie = `header.${sessionPayload}.signature`;

    const response = NextResponse.json({ ok: true, role, collegeId, name, email, profile });
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
