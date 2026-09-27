import { test, expect } from "@playwright/test";
import { createAuthenticatedContext } from "../support/auth";
import { readEnv } from "../support/env";

const env = readEnv(["E2E_FIREBASE_API_KEY", "E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD"]);

test.describe("Subject Semester Assignments API", () => {
  let ctx: Awaited<ReturnType<typeof createAuthenticatedContext>>;

  test.beforeAll(async () => {
    if (!env) { test.skip(); return; }
    ctx = await createAuthenticatedContext({ email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD });
  });

  test("GET /api/college/subject-semester-assignments requires catalogId and year", async () => {
    test.skip(!env, "missing env vars");
    const res = await ctx.get("/api/college/subject-semester-assignments");
    expect(res.status()).toBe(400);
  });

  test("POST /api/college/subject-semester-assignments requires all fields", async () => {
    test.skip(!env, "missing env vars");
    const res = await ctx.post("/api/college/subject-semester-assignments", {
      data: { subjectId: "sub1", catalogId: "cat1" },
    });
    expect(res.status()).toBe(400);
  });
});
