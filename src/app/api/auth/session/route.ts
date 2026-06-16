export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";

export async function POST(request: Request) {
  try {
    const { token } = (await request.json()) as { token: string };

    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    const decoded = await adminAuth.verifyIdToken(token);

    const sessionData = {
      uid: decoded.uid,
      email: decoded.email,
      role: decoded.role ?? "UNKNOWN",
      collegeId: decoded.collegeId ?? "",
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
    console.error("[auth/session]", err);
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("fms-session");
  return response;
}
