import { request as pwRequest, type APIRequestContext } from "@playwright/test";

// There is no test-only auth bypass in this app - src/lib/auth/verifyFirebaseToken.ts
// always verifies a real, RS256-signed Firebase Auth ID token, and
// src/app/api/auth/session/route.ts only ever mints the `fms-session` cookie
// from one. So every E2E test that hits an authenticated route needs a real,
// seeded Firebase Auth user in the project tests/e2e/.env.test points at -
// this is the same two-step flow the browser client performs (Firebase Auth
// sign-in, then POST /api/auth/session), just driven from Node instead.
//
// The returned APIRequestContext keeps its own cookie jar (Playwright's
// documented behavior for api request contexts), so the fms-session cookie
// set by /api/auth/session is automatically resent on every later request
// made through it - callers never touch the cookie directly.
export async function createAuthenticatedContext(account: {
  email: string;
  password: string;
}): Promise<APIRequestContext> {
  const apiKey = process.env.E2E_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error("E2E_FIREBASE_API_KEY is not set - see tests/e2e/README.md");
  }
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

  const ctx = await pwRequest.newContext({ baseURL });

  const signInRes = await ctx.post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    { data: { email: account.email, password: account.password, returnSecureToken: true } }
  );
  if (!signInRes.ok()) {
    const body = await signInRes.text();
    await ctx.dispose();
    throw new Error(`Firebase sign-in failed for ${account.email}: ${signInRes.status()} ${body}`);
  }
  const { idToken } = (await signInRes.json()) as { idToken: string };

  const sessionRes = await ctx.post("/api/auth/session", { data: { token: idToken } });
  if (!sessionRes.ok()) {
    const body = await sessionRes.text();
    await ctx.dispose();
    throw new Error(`POST /api/auth/session failed for ${account.email}: ${sessionRes.status()} ${body}`);
  }

  return ctx;
}
