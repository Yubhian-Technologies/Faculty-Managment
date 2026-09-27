import { test, expect } from "@playwright/test";
import { createAuthenticatedContext } from "../support/auth";
import { readEnv } from "../support/env";

const env = readEnv(["E2E_FIREBASE_API_KEY", "E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD"]);

test.describe("Teaching Assignments API", () => {
  let ctx: Awaited<ReturnType<typeof createAuthenticatedContext>>;

  test.beforeAll(async () => {
    if (!env) { test.skip(); return; }
    ctx = await createAuthenticatedContext({ email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD });
  });

  test("GET /api/college/teaching-assignments requires sectionId or dept", async () => {
    test.skip(!env, "missing env vars");
    const res = await ctx.get("/api/college/teaching-assignments");
    expect(res.status()).toBeLessThan(500);
  });

  test("POST /api/college/teaching-assignments rejects missing section", async () => {
    test.skip(!env, "missing env vars");
    const suffix = Date.now().toString();
    const res = await ctx.post("/api/college/teaching-assignments", {
      data: {
        facultyId: "fac1", facultyName: "Test", department: "CS",
        subjectId: "sub1", subjectName: "DSA", subjectCode: "DSA101",
        hoursPerWeek: 3, assignmentAcademicYear: "", assignmentSemester: "",
      },
    });
    expect(res.status()).toBe(400);
  });
});
