import { test, expect, type APIRequestContext } from "@playwright/test";
import { createAuthenticatedContext } from "../support/auth";
import { readEnv } from "../support/env";
import { validFacultyCreatePayload, validLinkHodPayload } from "../support/fixtures";

// Re-verifies the three sub-HOD department-scope checks the 2026-09-25 audit
// commit (4e2f94c2) fixed - a sub-HOD could previously orphan records or
// create a login for any faculty college-wide. See
// src/lib/departments/scope.ts's canHodManageFacultyDepartment: an HOD may
// manage (edit sections/subjects/timetable for) a branch handed to them as a
// managed/grouped assignment, but that branch's FACULTY roster is deliberately
// out of reach until it gets its own dedicated HOD login - own department and
// true child sub-departments only.
//
// Needs a seeded sub-HOD account whose own department manages at least one
// other, unowned branch - see tests/e2e/README.md for the exact seed shape,
// required env vars, and the opt-in seed script. Each test skips itself (not
// the whole file) when ITS OWN env vars are missing, so a partially-seeded
// project still runs whatever it can - a fully-seeded run exercises both the
// denial (403) and the positive control for every scenario, so a regression
// that turns these into a blanket-deny is also caught, not just the original
// blanket-allow bug.

let subHodCtx: APIRequestContext | null = null;

test.afterAll(async () => {
  await subHodCtx?.dispose();
});

async function getSubHodContext(email: string, password: string): Promise<APIRequestContext> {
  if (!subHodCtx) {
    subHodCtx = await createAuthenticatedContext({ email, password });
  }
  return subHodCtx;
}

test.describe("Scenario A - sub-HOD creates faculty (POST /api/college/faculty)", () => {
  test("succeeds in the sub-HOD's own department", async () => {
    const env = readEnv(["E2E_FIREBASE_API_KEY", "E2E_SUBHOD_EMAIL", "E2E_SUBHOD_PASSWORD", "E2E_SUBHOD_OWN_DEPARTMENT"] as const);
    test.skip(!env, "Missing E2E_SUBHOD_* env vars - see tests/e2e/README.md");
    const ctx = await getSubHodContext(env!.E2E_SUBHOD_EMAIL, env!.E2E_SUBHOD_PASSWORD);

    const res = await ctx.post("/api/college/faculty", {
      data: validFacultyCreatePayload(env!.E2E_SUBHOD_OWN_DEPARTMENT),
    });

    expect(res.status()).toBe(201);
  });

  test("403s in a branch the sub-HOD only manages (not owns)", async () => {
    const env = readEnv([
      "E2E_FIREBASE_API_KEY", "E2E_SUBHOD_EMAIL", "E2E_SUBHOD_PASSWORD", "E2E_SUBHOD_MANAGED_DEPARTMENT",
    ] as const);
    test.skip(!env, "Missing E2E_SUBHOD_MANAGED_DEPARTMENT - see tests/e2e/README.md");
    const ctx = await getSubHodContext(env!.E2E_SUBHOD_EMAIL, env!.E2E_SUBHOD_PASSWORD);

    const res = await ctx.post("/api/college/faculty", {
      data: validFacultyCreatePayload(env!.E2E_SUBHOD_MANAGED_DEPARTMENT),
    });

    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe("That department is not yours or one of your sub-departments");
  });
});

test.describe("Scenario B - sub-HOD attempts link-hod (POST /api/college/faculty/link-hod)", () => {
  test("403s when the department is a managed branch, not owned", async () => {
    const env = readEnv([
      "E2E_FIREBASE_API_KEY", "E2E_SUBHOD_EMAIL", "E2E_SUBHOD_PASSWORD", "E2E_SUBHOD_MANAGED_DEPARTMENT",
    ] as const);
    test.skip(!env, "Missing E2E_SUBHOD_MANAGED_DEPARTMENT - see tests/e2e/README.md");
    const ctx = await getSubHodContext(env!.E2E_SUBHOD_EMAIL, env!.E2E_SUBHOD_PASSWORD);

    // linkUid doesn't need to resolve to a real login for this assertion - the
    // department-scope check (link-hod/route.ts:86-94) runs before the
    // target-login lookup (:96-113), so a syntactically-valid but made-up uid
    // still reaches, and fails, the check this test is pinning.
    const res = await ctx.post("/api/college/faculty/link-hod", {
      data: validLinkHodPayload(env!.E2E_SUBHOD_MANAGED_DEPARTMENT, "nonexistent-uid-for-scope-test"),
    });

    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe("That department is not yours or one of your sub-departments");
  });

  test("succeeds for the sub-HOD's own department, linking that department's own recorded HOD login", async () => {
    const env = readEnv([
      "E2E_FIREBASE_API_KEY", "E2E_SUBHOD_EMAIL", "E2E_SUBHOD_PASSWORD",
      "E2E_SUBHOD_OWN_DEPARTMENT", "E2E_LINK_HOD_TARGET_UID",
    ] as const);
    test.skip(!env, "Missing E2E_LINK_HOD_TARGET_UID - see tests/e2e/README.md");
    const ctx = await getSubHodContext(env!.E2E_SUBHOD_EMAIL, env!.E2E_SUBHOD_PASSWORD);

    const res = await ctx.post("/api/college/faculty/link-hod", {
      data: validLinkHodPayload(env!.E2E_SUBHOD_OWN_DEPARTMENT, env!.E2E_LINK_HOD_TARGET_UID),
    });

    // 201 (created) or 200 (already linked - link-hod is idempotent, see
    // route.ts:120-122) both prove the scope check let the request through.
    expect([200, 201]).toContain(res.status());
  });
});

test.describe("Scenario C - create a login for faculty outside the caller's department (POST /api/college/faculty/[id]/login)", () => {
  test("403s for a faculty record in a branch the sub-HOD only manages", async () => {
    const env = readEnv([
      "E2E_FIREBASE_API_KEY", "E2E_SUBHOD_EMAIL", "E2E_SUBHOD_PASSWORD", "E2E_FACULTY_ID_IN_MANAGED_DEPARTMENT",
    ] as const);
    test.skip(!env, "Missing E2E_FACULTY_ID_IN_MANAGED_DEPARTMENT - see tests/e2e/README.md");
    const ctx = await getSubHodContext(env!.E2E_SUBHOD_EMAIL, env!.E2E_SUBHOD_PASSWORD);

    const res = await ctx.post(`/api/college/faculty/${env!.E2E_FACULTY_ID_IN_MANAGED_DEPARTMENT}/login`, {
      data: { email: `e2e.login.${Date.now()}@example-college.test`, password: "TestPassword123!" },
    });

    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe("That faculty member is not in your department");
  });

  test("succeeds for a faculty record in the sub-HOD's own department", async () => {
    const env = readEnv([
      "E2E_FIREBASE_API_KEY", "E2E_SUBHOD_EMAIL", "E2E_SUBHOD_PASSWORD", "E2E_FACULTY_ID_IN_OWN_DEPARTMENT",
    ] as const);
    test.skip(!env, "Missing E2E_FACULTY_ID_IN_OWN_DEPARTMENT - see tests/e2e/README.md");
    const ctx = await getSubHodContext(env!.E2E_SUBHOD_EMAIL, env!.E2E_SUBHOD_PASSWORD);

    const res = await ctx.post(`/api/college/faculty/${env!.E2E_FACULTY_ID_IN_OWN_DEPARTMENT}/login`, {
      data: { email: `e2e.login.${Date.now()}@example-college.test`, password: "TestPassword123!" },
    });

    expect(res.status()).toBe(201);
  });
});
