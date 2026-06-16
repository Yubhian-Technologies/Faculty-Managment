import { cookies } from "next/headers";

interface SessionPayload {
  uid: string;
  email: string;
  role: string;
  collegeId: string;
  exp: number;
}

export async function verifySession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("fms-session")?.value;
  if (!sessionCookie) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(sessionCookie.split(".")[1], "base64").toString()
    ) as SessionPayload;

    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function requireSuperAdmin(): Promise<SessionPayload> {
  const session = await verifySession();
  if (!session || session.role !== "SUPER_ADMIN") {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

export async function requireRole(...roles: string[]): Promise<SessionPayload> {
  const session = await verifySession();
  if (!session || !roles.includes(session.role)) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

export async function requireCollegeMember(...roles: string[]): Promise<SessionPayload & { collegeId: string }> {
  const session = await requireRole(...roles);
  if (!session.collegeId) {
    throw new Error("NO_COLLEGE_CONTEXT");
  }
  return session as SessionPayload & { collegeId: string };
}
