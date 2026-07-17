// Builds an fms-session cookie exactly the way src/app/api/auth/session/route.ts
// does: base64(JSON) wrapped in a JWT-shaped `header.<payload>.signature`
// string. verifySession.ts (src/lib/auth/verifySession.ts) only base64-decodes
// this — it is NOT cryptographically verified on read — so a test can mint a
// valid session for any role/uid/collegeId without a real Firebase login.
// See SEC-01 in the QA test plan: this is a deliberate test-suite shortcut
// that doubles as a documented security finding, not an oversight.
//
// AUTH_MODE=login switches to the real path (Identity Toolkit REST sign-in +
// POST /api/auth/session) for suites that specifically want to exercise
// that route (see tests/e2e/ui/login.spec.ts).

import type { APIRequestContext, BrowserContext } from "@playwright/test";
import type { TestUser } from "./testUsers";

const SESSION_COOKIE_NAME = "fms-session";
const ONE_DAY_SECONDS = 60 * 60 * 24;

function buildSessionCookieValue(user: TestUser): string {
  const payload = {
    uid: user.uid,
    email: user.email,
    role: user.role,
    collegeId: user.collegeId,
    locationId: user.locationId,
    exp: Math.floor(Date.now() / 1000) + ONE_DAY_SECONDS,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `header.${b64}.signature`;
}

function cookieDomain(baseURL: string | undefined): string {
  try {
    return new URL(baseURL ?? "http://localhost:3000").hostname;
  } catch {
    return "localhost";
  }
}

/** Injects a session cookie into a browser context ahead of any `page.goto`. */
export async function loginAsViaCookie(
  context: BrowserContext,
  user: TestUser,
  baseURL: string | undefined
): Promise<void> {
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: buildSessionCookieValue(user),
      domain: cookieDomain(baseURL),
      path: "/",
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
}

/** Returns the raw cookie header value, for use with an APIRequestContext that isn't tied to a BrowserContext. */
export function sessionCookieHeader(user: TestUser): string {
  return `${SESSION_COOKIE_NAME}=${buildSessionCookieValue(user)}`;
}

/** Real login via Firebase Identity Toolkit REST + the app's own session route. Requires TEST_*_PASSWORD and NEXT_PUBLIC_FIREBASE_API_KEY. */
export async function loginViaFirebaseAuth(
  request: APIRequestContext,
  baseURL: string,
  user: TestUser
): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is required for AUTH_MODE=login");
  if (!user.password) throw new Error(`No password configured for ${user.email} — set its TEST_*_PASSWORD env var`);

  const signInRes = await request.post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    { data: { email: user.email, password: user.password, returnSecureToken: true } }
  );
  if (!signInRes.ok()) {
    throw new Error(`Firebase sign-in failed for ${user.email}: ${await signInRes.text()}`);
  }
  const { idToken } = (await signInRes.json()) as { idToken: string };

  const sessionRes = await request.post(`${baseURL}/api/auth/session`, { data: { token: idToken } });
  if (!sessionRes.ok()) {
    throw new Error(`/api/auth/session failed for ${user.email}: ${await sessionRes.text()}`);
  }
  const setCookie = sessionRes.headers()["set-cookie"] ?? "";
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  if (!match) throw new Error("Session response did not set fms-session cookie");
  return `${SESSION_COOKIE_NAME}=${match[1]}`;
}
