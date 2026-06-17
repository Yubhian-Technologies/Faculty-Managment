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
    // Fall back to Firestore systemUsers collection for users created via REST API.
    let role = (decoded.role as string) ?? "";
    let collegeId = (decoded.collegeId as string) ?? "";

    if (!role) {
      try {
        const db = getAdminDb();
        const snap = await db.collection("systemUsers").doc(decoded.uid).get();
        const data = snap.data() as { role?: string; collegeId?: string } | undefined;
        role = data?.role ?? "UNKNOWN";
        collegeId = data?.collegeId ?? "";
      } catch {
        role = "UNKNOWN";
      }
    }

    const sessionData = {
      uid: decoded.uid,
      email: decoded.email ?? "",
      role,
      collegeId,
      exp: decoded.exp,
    };

    const sessionPayload = Buffer.from(JSON.stringify(sessionData)).toString("base64");
    const sessionCookie = `header.${sessionPayload}.signature`;

    const response = NextResponse.json({ ok: true });
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
