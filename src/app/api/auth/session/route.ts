export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";

export async function POST(request: Request) {
  // Log env var presence (not values) to Vercel function logs
  console.log("[session] env check:", {
    hasProjectId: !!process.env.FIREBASE_ADMIN_PROJECT_ID,
    hasClientEmail: !!process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    hasPrivateKey: !!process.env.FIREBASE_ADMIN_PRIVATE_KEY,
    privateKeyStart: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.slice(0, 30),
  });

  try {
    const body = await request.json() as { token?: string };
    const { token } = body;

    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    const auth = getAdminAuth();
    const decoded = await auth.verifyIdToken(token);

    const sessionData = {
      uid: decoded.uid,
      email: decoded.email,
      role: (decoded.role as string) ?? "UNKNOWN",
      collegeId: (decoded.collegeId as string) ?? "",
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
    console.error("[auth/session] verifyIdToken failed:", message);
    return NextResponse.json({ error: "Invalid token", detail: message }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("fms-session");
  return response;
}
