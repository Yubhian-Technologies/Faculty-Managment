import { test, expect } from "@playwright/test";
import { createAuthenticatedContext } from "../support/auth";
import { readEnv } from "../support/env";

const env = readEnv(["E2E_FIREBASE_API_KEY", "E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD"]);

test.describe("Student Attendance API", () => {
  let ctx: Awaited<ReturnType<typeof createAuthenticatedContext>>;

  test.beforeAll(async () => {
    if (!env) { test.skip(); return; }
    ctx = await createAuthenticatedContext({ email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD });
  });

  test("POST /api/college/student-attendance requires assignmentId and date", async () => {
    test.skip(!env, "missing env vars");
    const res = await ctx.post("/api/college/student-attendance", {
      data: { assignmentId: "asm1", date: "2026-09-26" },
    });
    expect(res.status()).toBe(400);
  });

  test("POST /api/college/student-attendance rejects invalid date format", async () => {
    test.skip(!env, "missing env vars");
    const res = await ctx.post("/api/college/student-attendance", {
      data: { assignmentId: "asm1", date: "invalid" },
    });
    expect(res.status()).toBe(400);
  });
});
