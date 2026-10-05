export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { verifyPassword } from "@/lib/firebase/authRest";
import { checkRateLimit, clientIp } from "@/lib/security/rateLimit";
import { MAX_EMPLOYEE_ID_LENGTH, findFacultyLoginUid } from "@/lib/faculty/loginLookup";

// Faculty sign in with Employee ID + the same password as their email login.
// The password is checked HERE and a custom token is returned, so the faculty's
// email is never sent to the (unauthenticated) caller. Every failure that could
// reveal whether an ID exists (unknown ID, no login, wrong password) is the same
// generic 401. Public endpoint: rate limited per address and per ID, like
// resolve-student-login.
const IP_LIMIT = 30;
const KEY_LIMIT = 10;
const WINDOW_MS = 60_000;

const INVALID = () =>
  NextResponse.json({ error: "Invalid username or password. Please try again." }, { status: 401 });

function tooMany(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many attempts - please wait a minute and try again" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

export async function POST(request: Request) {
  try {
    const ip = checkRateLimit(`employee-login:ip:${clientIp(request)}`, IP_LIMIT, WINDOW_MS);
    if (!ip.allowed) return tooMany(ip.retryAfterSeconds);

    let body: { employeeId?: unknown; password?: unknown };
    try {
      body = (await readJsonBody(request)) as { employeeId?: unknown; password?: unknown };
    } catch {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const employeeId = typeof body?.employeeId === "string" ? body.employeeId.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!employeeId || !password) {
      return NextResponse.json({ error: "Employee ID and password are required" }, { status: 400 });
    }
    if (employeeId.length > MAX_EMPLOYEE_ID_LENGTH || password.length > 256) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const perKey = checkRateLimit(`employee-login:key:${employeeId.toLowerCase()}`, KEY_LIMIT, WINDOW_MS);
    if (!perKey.allowed) return tooMany(perKey.retryAfterSeconds);

    const uid = await findFacultyLoginUid(getAdminDb(), employeeId);
    if (!uid) return INVALID();

    const adminAuth = await getAdminAuth();
    const email = (await adminAuth.getUser(uid).catch(() => null))?.email;
    if (!email) return INVALID();

    const result = await verifyPassword(email, password);
    if (result === "USER_DISABLED") {
      return NextResponse.json(
        { error: "This account has been disabled. Contact your administrator." },
        { status: 403 }
      );
    }
    if (result !== "ok") return INVALID();

    return NextResponse.json({ customToken: await adminAuth.createCustomToken(uid) });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    console.error("[auth/employee-login POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
