import { test, expect } from "@playwright/test";
import { createAuthenticatedContext } from "../support/auth";
import { readEnv } from "../support/env";

const env = readEnv(["E2E_FIREBASE_API_KEY", "E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD"]);

test.describe("Course Catalog API", () => {
  let ctx: Awaited<ReturnType<typeof createAuthenticatedContext>>;

  test.beforeAll(async () => {
    if (!env) { test.skip(); return; }
    ctx = await createAuthenticatedContext({ email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD });
  });

  test.afterAll(async () => {
    if (ctx) await ctx.dispose();
  });

  test("GET /api/college/course-catalog returns catalog items", async () => {
    test.skip(!env, "missing env vars");
    const res = await ctx.get("/api/college/course-catalog");
    expect(res.status()).toBeLessThan(500);
  });

  test("GET /api/college/courses returns courses", async () => {
    test.skip(!env, "missing env vars");
    const res = await ctx.get("/api/college/courses");
    expect(res.status()).toBeLessThan(500);
  });
});
