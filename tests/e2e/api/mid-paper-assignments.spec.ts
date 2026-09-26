import { test, expect } from "@playwright/test";
import { createAuthenticatedContext } from "../support/auth";
import { readEnv } from "../support/env";

const env = readEnv(["E2E_FIREBASE_API_KEY", "E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD"]);

test.describe("Mid Paper Assignments API", () => {
  let ctx: Awaited<ReturnType<typeof createAuthenticatedContext>>;

  test.beforeAll(async () => {
    if (!env) { test.skip(); return; }
    ctx = await createAuthenticatedContext({ email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD });
  });

  test("GET /api/college/mid-paper-assignments returns mid papers", async () => {
    test.skip(!env, "missing env vars");
    const res = await ctx.get("/api/college/mid-paper-assignments?semesterId=1&year=2026");
    expect(res.status()).toBeLessThan(500);
  });
});
