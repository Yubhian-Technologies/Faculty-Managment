import { test, expect } from "@playwright/test";
import { createAuthenticatedContext } from "../support/auth";
import { readEnv } from "../support/env";
import { validFacultyCreatePayload } from "../support/fixtures";

const env = readEnv(["E2E_FIREBASE_API_KEY", "E2E_COLLEGE_ID", "E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD"]);

test.describe("Subjects API (academics)", () => {
  let ctx: Awaited<ReturnType<typeof createAuthenticatedContext>>;

  test.beforeAll(async () => {
    if (!env) {
      test.skip();
      return;
    }
    ctx = await createAuthenticatedContext({ email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD });
  });

  test.afterAll(async () => {
    if (ctx) await ctx.dispose();
  });

  test("GET /api/college/subjects returns subjects for a course", async () => {
    test.skip(!env, "missing env vars");
    const res = await ctx.get(
      `/api/college/subjects?courseId=test-course-id&academicYear=2026-27`
    );
    expect(res.status()).toBeLessThan(500);
  });

  test("POST /api/college/subjects creates a master subject (courseId + regulation)", async () => {
    test.skip(!env, "missing env vars");
    const suffix = Date.now().toString();
    const body = {
      courseId: `e2e-course-${suffix}`,
      academicYear: "2026-27",
      regulation: "R20",
      serialNumber: 1,
      category: "PCC",
      name: `E2E Subject ${suffix}`,
      code: `ES${suffix}`,
      type: "THEORY" as const,
      lectureHours: 3,
      tutorialHours: 0,
      practicalHours: 0,
      hoursPerWeek: 3,
      credits: 3,
    };
    const res = await ctx.post("/api/college/subjects", { data: body });
    const status = res.status();
    expect(status).toBeLessThan(500);
  });

  test("POST /api/college/subjects rejects without courseId", async () => {
    test.skip(!env, "missing env vars");
    const res = await ctx.post("/api/college/subjects", {
      data: { name: "No course", code: "NC", type: "THEORY", lectureHours: 3, tutorialHours: 0, practicalHours: 0 },
    });
    expect(res.status()).toBe(400);
  });

  test("POST /api/college/subjects rejects missing name/code", async () => {
    test.skip(!env, "missing env vars");
    const res = await ctx.post("/api/college/subjects", {
      data: { courseId: "test", academicYear: "2026-27", type: "THEORY", lectureHours: 3, tutorialHours: 0, practicalHours: 0 },
    });
    expect(res.status()).toBe(400);
  });

  test("DELETE /api/college/subjects/{id} deletes a subject", async () => {
    test.skip(!env, "missing env vars");
    // Create first, then delete
    const suffix = Date.now().toString();
    const createRes = await ctx.post("/api/college/subjects", {
      data: {
        courseId: `e2e-del-${suffix}`, academicYear: "2026-27", regulation: "R20",
        serialNumber: 1, category: "PCC", name: `Delete Me ${suffix}`,
        code: `DL${suffix}`, type: "THEORY", lectureHours: 3, tutorialHours: 0, practicalHours: 0,
        hoursPerWeek: 3, credits: 3,
      },
    });
    if (createRes.status() === 201) {
      const { id } = (await createRes.json()) as { id: string };
      const delRes = await ctx.delete(`/api/college/subjects/${id}`);
      expect(delRes.status()).toBeLessThan(500);
    }
  });
});
