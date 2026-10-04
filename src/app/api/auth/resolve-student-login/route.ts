export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { checkRateLimit, clientIp } from "@/lib/security/rateLimit";
import { studentRollKey } from "@/lib/students/loginDefaults";
import { MAX_ROLL_LENGTH, findStudentLoginEmails, placeholderLoginEmail } from "@/lib/students/resolveLogin";

// Server-side (Admin SDK) resolver the login page calls whenever the identifier
// isn't an email: a student knows only their Roll Number, never their real
// (synthetic) Firebase Auth email, so this looks the email(s) up for them -
// across every college, since the login page has no college picker. Never a
// client Firestore query: it must not leak any other student's data.
//
// It is public, so it is hardened as a public endpoint:
//  - rate limited per address and per roll (in-memory, per instance - see
//    lib/security/rateLimit.ts for what that does and doesn't guarantee);
//  - answers the SAME way whether or not the roll has a login (an unknown roll
//    gets a placeholder email that fails to sign in like a wrong password), so
//    it can't be used to enumerate roll numbers;
//  - malformed bodies and absurd lengths are a 400, not a server error.
// Several candidates come back when two colleges share a roll; the client tries
// each with the typed password.
const IP_LIMIT = 30;
const KEY_LIMIT = 10;
const WINDOW_MS = 60_000;

function tooMany(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many attempts - please wait a minute and try again" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

export async function POST(request: Request) {
  try {
    const ip = checkRateLimit(`resolve-student:ip:${clientIp(request)}`, IP_LIMIT, WINDOW_MS);
    if (!ip.allowed) return tooMany(ip.retryAfterSeconds);

    let body: { rollNumber?: unknown };
    try {
      body = (await request.json()) as { rollNumber?: unknown };
    } catch {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const rollNumber = typeof body?.rollNumber === "string" ? body.rollNumber.trim() : "";
    if (!rollNumber) {
      return NextResponse.json({ error: "Roll Number is required" }, { status: 400 });
    }
    if (rollNumber.length > MAX_ROLL_LENGTH) {
      return NextResponse.json({ error: "Roll Number is too long" }, { status: 400 });
    }

    const key = studentRollKey(rollNumber) || rollNumber.toLowerCase();
    const perKey = checkRateLimit(`resolve-student:key:${key}`, KEY_LIMIT, WINDOW_MS);
    if (!perKey.allowed) return tooMany(perKey.retryAfterSeconds);

    const emails = await findStudentLoginEmails(getAdminDb(), rollNumber);
    const loginEmails = emails.length > 0 ? emails : [placeholderLoginEmail(rollNumber)];
    return NextResponse.json({ loginEmail: loginEmails[0], loginEmails });
  } catch (err) {
    console.error("[auth/resolve-student-login POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
