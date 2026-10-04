import { NextResponse } from "next/server";

// One mapping from Firebase Auth errors to client-safe responses, so a weak password or an
// existing email is a clear 4xx instead of a generic 500 - and never the raw SDK message, which can
// include internal detail. Routes call it near the end of their catch, after their own specific
// handling, so existing messages are unchanged.

const MAP: Record<string, { status: number; error: string }> = {
  "auth/email-already-exists": { status: 409, error: "An account with this email already exists" },
  "auth/uid-already-exists": { status: 409, error: "An account for this user already exists" },
  "auth/invalid-email": { status: 400, error: "Enter a valid email address" },
  "auth/invalid-password": { status: 400, error: "Password must be at least 6 characters" },
  "auth/weak-password": { status: 400, error: "Password is too weak - use at least 6 characters" },
  "auth/invalid-phone-number": { status: 400, error: "Enter a valid phone number" },
  "auth/user-not-found": { status: 404, error: "No login account found for this user" },
  "auth/too-many-requests": { status: 429, error: "Too many attempts - please try again later" },
};

export function firebaseAuthErrorResponse(err: unknown): NextResponse | null {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  const hit = MAP[code];
  return hit ? NextResponse.json({ error: hit.error }, { status: hit.status }) : null;
}
