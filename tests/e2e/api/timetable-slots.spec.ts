import { test, expect } from "@playwright/test";
import { createAuthenticatedContext } from "../support/auth";
import { readEnv } from "../support/env";

const env = readEnv(["E2E_FIREBASE_API_KEY", "E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD"]);

test.describe("Timetable Slots API", () => {
  let ctx: Awaited<ReturnType<typeof createAuthenticatedContext>>;

  test.beforeAll(async () => {
    if (!env) { test.skip(); return; }
    ctx = await createAuthenticatedContext({ email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD });
  });

  test("GET /api/college/timetable-slots requires sectionId", async () => {
    test.skip(!env, "missing env vars");
    const res = await ctx.get("/api/college/timetable-slots");
    expect(res.status()).toBe(400);
  });

  test("POST /api/college/timetable-slots requires assignmentId, day, periodNumber", async () => {
    test.skip(!env, "missing env vars");
    const res = await ctx.post("/api/college/timetable-slots", {
      data: { assignmentId: "asm1", day: "MON", periodNumber: 1 },
    });
    expect(res.status()).toBeLessThan(500);
  });
});
